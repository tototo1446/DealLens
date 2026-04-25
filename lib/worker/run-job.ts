import {
  getJob,
  updateJob,
  saveExtractionResults,
  saveTranscript,
  getTranscript,
  appendJobLog,
  checkCancellation,
  JobCancelledError,
} from "@/lib/db/jobs";
import { extractAudioMp3 } from "@/lib/ffmpeg/extract-audio";
import {
  extractCategories,
  transcribeAudioChunked,
  type ExtractionMap,
} from "@/lib/ai/pipeline";
import { upsertExtractionRow } from "@/lib/sheets/upsert";

/**
 * Phase A: 動画ソース確認 → 音声抽出 → 文字起こし → transcript を DB に保存
 *
 * 完了時に Phase B (/api/worker/extract) を fetch で kick することで、
 * Vercel Function の maxDuration=800s を独立に消費できる。
 * 4時間以上の長尺動画でも 1 Function 内で全工程を済ませようとせずに済む。
 */
export async function runJobTranscribe(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  const log = (message: string) => appendJobLog(jobId, message);
  const logWarn = (message: string) => appendJobLog(jobId, message, "warn");

  try {
    await log(`ジョブ開始 (source: ${job.source_type})`);

    // 1+2. ダウンロード省略 + 音声抽出
    // ffmpeg に Blob URL を直接渡してネットワーク経由でストリーミング処理させる。
    // /tmp に動画を一切置かないので、Vercel の /tmp 容量上限 (~1GB) を回避できる。
    await checkCancellation(jobId);
    await updateJob(jobId, { status: "downloading" });
    await log(`動画ソース: ${truncate(job.source_uri, 80)}`);
    await updateJob(jobId, { status: "transcoding" });
    await log(
      "ffmpegで音声(mp3)を抽出中… (URLストリーミング読み込み・ローカル保存なし)"
    );
    const tAudio = Date.now();
    const audio = await extractAudioMp3(job.source_uri);
    await log(
      `音声抽出完了 (${formatMB(audio.byteLength)}, ${elapsed(tAudio)})`
    );

    // 3. 文字起こし
    await checkCancellation(jobId);
    await updateJob(jobId, { status: "analyzing" });
    await log(
      "Gemini に文字起こしをリクエスト中… (8分ごとにチャンク分割→並列処理)"
    );
    const tTrans = Date.now();
    const { result: transcript, diagnostics } = await transcribeAudioChunked(
      audio,
      {
        chunkSec: 480,
        concurrency: 5,
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

    // 4. Phase B (extract) を別 Function として kick する
    await log("Phase B (カテゴリ抽出+シート書込) を別 Function に引き継ぎます…");
    await kickExtractPhase(jobId);
    await log("Phase B を起動しました。残処理は新しい Function に引き継ぎ済みです");
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

/**
 * Phase B: 保存済み transcript を読み込んで → カテゴリ抽出 → シート書込
 *
 * /api/worker/extract から after() で呼ばれる。
 */
export async function runJobExtract(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  const log = (message: string) => appendJobLog(jobId, message);

  try {
    await log("Phase B 開始 (カテゴリ抽出+シート書込)");

    const t = await getTranscript(jobId);
    if (!t || !t.full_text) {
      throw new Error("transcript が DB に存在しません。文字起こしの再実行が必要です");
    }

    // 4. カテゴリ抽出
    await checkCancellation(jobId);
    await updateJob(jobId, { status: "analyzing" });
    await log(
      `Gemini に 14項目の構造化抽出をリクエスト中… (transcript ${t.full_text.length}文字)`
    );
    const tExt = Date.now();
    const extracted: ExtractionMap = await extractCategories(t.full_text);
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

    // 5. シート書き込み
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

/**
 * 後方互換: 旧来の単一フェーズ runJob 呼び出し向け。
 * Phase A を呼ぶだけ (Phase A の最後で Phase B が kick される)。
 */
export async function runJob(jobId: string): Promise<void> {
  await runJobTranscribe(jobId);
}

async function kickExtractPhase(jobId: string): Promise<void> {
  const appUrl = appBaseUrl();
  const token = process.env.INTERNAL_API_TOKEN ?? "";
  const res = await fetch(`${appUrl}/api/worker/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": token,
    },
    body: JSON.stringify({ job_id: jobId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Phase B kick failed: HTTP ${res.status} ${res.statusText} ${body.slice(0, 200)}`
    );
  }
}

function appBaseUrl(): string {
  // 本番では Vercel が設定する固定URLを使う。
  // request.url や VERCEL_URL は deployment 固有URLになるので避ける。
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prodHost) return `https://${prodHost}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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
