import {
  getJob,
  updateJob,
  saveExtractionResults,
  saveTranscript,
  appendJobLog,
  checkCancellation,
  JobCancelledError,
} from "@/lib/db/jobs";
import { downloadAsBuffer } from "@/lib/storage/blob";
import { extractAudioMp3 } from "@/lib/ffmpeg/extract-audio";
import {
  extractCategories,
  transcribeAudioChunked,
} from "@/lib/ai/pipeline";
import { upsertExtractionRow } from "@/lib/sheets/upsert";

export async function runJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  const log = (message: string) => appendJobLog(jobId, message);
  const logWarn = (message: string) => appendJobLog(jobId, message, "warn");

  try {
    await log(`ジョブ開始 (source: ${job.source_type})`);

    // 1. ダウンロード
    await checkCancellation(jobId);
    await updateJob(jobId, { status: "downloading" });
    await log(`動画の取得を開始: ${truncate(job.source_uri, 80)}`);
    const tDl = Date.now();
    const videoBuffer = await downloadAsBuffer(job.source_uri);
    await log(
      `動画の取得完了 (${formatMB(videoBuffer.byteLength)}, ${elapsed(tDl)})`
    );

    // 2. 音声抽出
    await checkCancellation(jobId);
    await updateJob(jobId, { status: "transcoding" });
    await log("ffmpegで音声(mp3)を抽出中…");
    const tAudio = Date.now();
    const audio = await extractAudioMp3(videoBuffer);
    await log(
      `音声抽出完了 (${formatMB(audio.byteLength)}, ${elapsed(tAudio)})`
    );

    // 3. 文字起こし
    await checkCancellation(jobId);
    await updateJob(jobId, { status: "analyzing" });
    await log("Gemini に文字起こしをリクエスト中… (10分ごとにチャンク分割→並列処理)");
    const tTrans = Date.now();
    const { result: transcript, diagnostics } = await transcribeAudioChunked(
      audio,
      {
        chunkSec: 600,
        concurrency: 3,
        onProgress: (m) => log(m),
      }
    );
    await log(
      `文字起こし完了 (${transcript.full_text.length}文字, ${elapsed(tTrans)})`
    );

    // 診断情報をログに残す（finishReason / token usage / parse error 等）
    const diagParts: string[] = [];
    if (diagnostics.finishReason)
      diagParts.push(`finishReason=${diagnostics.finishReason}`);
    if (diagnostics.promptTokens != null)
      diagParts.push(`promptTok=${diagnostics.promptTokens}`);
    if (diagnostics.outputTokens != null)
      diagParts.push(`outputTok=${diagnostics.outputTokens}`);
    if (diagnostics.thoughtsTokens)
      diagParts.push(`thoughtsTok=${diagnostics.thoughtsTokens}`);
    if (diagnostics.totalTokens != null)
      diagParts.push(`totalTok=${diagnostics.totalTokens}`);
    diagParts.push(`rawLen=${diagnostics.rawTextLength}`);
    if (diagnostics.blockReason)
      diagParts.push(`blockReason=${diagnostics.blockReason}`);
    if (diagParts.length > 0)
      await log(`Gemini 応答メタ: ${diagParts.join(", ")}`);

    if (!transcript.full_text || transcript.full_text.trim().length === 0) {
      const reasons: string[] = [];
      if (diagnostics.parseError)
        reasons.push(`JSONパース失敗(${diagnostics.parseError})`);
      if (diagnostics.finishReason && diagnostics.finishReason !== "STOP")
        reasons.push(`finishReason=${diagnostics.finishReason}`);
      if (diagnostics.blockReason)
        reasons.push(`blockReason=${diagnostics.blockReason}`);
      if (diagnostics.rawTextLength === 0) reasons.push("空応答");
      const why = reasons.length > 0 ? ` 原因: ${reasons.join(" / ")}` : "";
      await logWarn(
        `文字起こし結果が空でした。${why}${
          diagnostics.rawTextHead
            ? ` 応答冒頭: ${truncate(diagnostics.rawTextHead, 200)}`
            : ""
        }`
      );
    }
    await saveTranscript(jobId, transcript.full_text, transcript.segments);

    // 4. カテゴリ抽出
    await checkCancellation(jobId);
    await log("Gemini に 14項目の構造化抽出をリクエスト中…");
    const tExt = Date.now();
    const extracted = await extractCategories(transcript.full_text);
    const filled = Object.values(extracted).filter(
      (v) => v?.value != null && v.value !== ""
    ).length;
    await log(
      `抽出完了 (${filled}/${Object.keys(extracted).length || 14}項目, ${elapsed(tExt)})`
    );

    await saveExtractionResults(
      jobId,
      Object.entries(extracted).map(([k, v]) => ({
        category_key: k,
        value: v.value,
        confidence: v.confidence,
        evidence: v.evidence_quote,
      }))
    );
    await log("抽出結果を DB に保存しました");

    // 5. シート書き込み (失敗しても DB の抽出結果は残るので、後から再シートできるよう
    //    詳細エラーをログに残しつつ status=failed で終わらせる)
    await checkCancellation(jobId);
    await updateJob(jobId, { status: "writing_sheet" });
    const hasGasUrl = !!process.env.GAS_WEB_APP_URL;
    const hasGasSecret = !!process.env.GAS_SHARED_SECRET;
    await log(
      `Google スプレッドシートに行を追加中… (env: GAS_WEB_APP_URL=${
        hasGasUrl ? "set" : "MISSING"
      }, GAS_SHARED_SECRET=${hasGasSecret ? "set" : "MISSING"})`
    );
    const tSheet = Date.now();
    try {
      await upsertExtractionRow({ jobId, extracted });
    } catch (e) {
      const msg = formatError(e);
      await appendJobLog(
        jobId,
        `シート書き込み失敗 (${elapsed(tSheet)}): ${msg}`,
        "error"
      );
      throw e;
    }
    await log(`スプレッドシートへの書き込み完了 (${elapsed(tSheet)})`);

    await updateJob(jobId, {
      status: "done",
      completed_at: new Date().toISOString(),
    });
    await log("✓ 全工程完了");
  } catch (e) {
    if (e instanceof JobCancelledError) {
      await appendJobLog(jobId, "ユーザー操作により中断されました", "warn");
      return;
    }
    const message = formatError(e);
    await appendJobLog(jobId, `エラー: ${message}`, "error");
    await updateJob(jobId, {
      status: "failed",
      error: message,
      completed_at: new Date().toISOString(),
    });
    throw e;
  }
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === "string") parts.push(obj.message);
    if (typeof obj.code === "string") parts.push(`(code=${obj.code})`);
    if (typeof obj.details === "string" && parts.length === 0)
      parts.push(obj.details);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function elapsed(since: number): string {
  const sec = Math.round((Date.now() - since) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
