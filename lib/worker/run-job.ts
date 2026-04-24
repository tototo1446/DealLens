import {
  getJob,
  updateJob,
  saveExtractionResults,
  saveTranscript,
} from "@/lib/db/jobs";
import { downloadAsBuffer } from "@/lib/storage/blob";
import { fetchDriveFile } from "@/lib/storage/drive";
import { extractAudioMp3 } from "@/lib/ffmpeg/extract-audio";
import {
  classifyIndustry,
  extractCategories,
  transcribeAudio,
} from "@/lib/ai/pipeline";
import { upsertExtractionRow } from "@/lib/sheets/upsert";

/**
 * 1ジョブを最後まで実行する。エラー時は status=failed + error を記録する。
 */
export async function runJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  try {
    // 1. ダウンロード
    await updateJob(jobId, { status: "downloading" });
    const videoBuffer = await fetchSource(job.source_type, job.source_uri);

    // 2. 音声抽出
    await updateJob(jobId, { status: "transcoding" });
    const audio = await extractAudioMp3(videoBuffer);

    // 3. 解析（Stage 1〜3）
    await updateJob(jobId, { status: "analyzing" });
    const transcript = await transcribeAudio(audio);
    await saveTranscript(jobId, transcript.full_text, transcript.segments);

    const industry = await classifyIndustry(transcript.full_text);
    await updateJob(jobId, { industry: industry.industry });

    const extracted = await extractCategories(
      transcript.full_text,
      industry.industry
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

    // 4. シート書き込み
    await updateJob(jobId, { status: "writing_sheet" });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    await upsertExtractionRow({
      jobId,
      filename: job.original_filename,
      industry: industry.industry,
      extracted,
      evidenceUrl: appUrl ? `${appUrl}/jobs/${jobId}` : "",
    });

    await updateJob(jobId, {
      status: "done",
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateJob(jobId, { status: "failed", error: message });
    throw e;
  }
}

async function fetchSource(
  type: "upload" | "drive_url" | "gigafile",
  uri: string
): Promise<Buffer> {
  switch (type) {
    case "upload":
      return downloadAsBuffer(uri);
    case "drive_url":
      return fetchDriveFile(uri);
    case "gigafile":
      throw new Error(
        "ギガファイル便は現状未対応。Google Driveに置き直してください。"
      );
  }
}
