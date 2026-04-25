import { supabaseAdmin } from "./supabase";

export type JobStatus =
  | "queued"
  | "downloading"
  | "transcoding"
  | "analyzing"
  | "writing_sheet"
  | "done"
  | "failed"
  | "cancelling"
  | "cancelled";

export type LogLevel = "info" | "warn" | "error";

export type JobLog = {
  id: string;
  job_id: string;
  level: LogLevel;
  message: string;
  created_at: string;
};

export class JobCancelledError extends Error {
  constructor() {
    super("job cancelled");
    this.name = "JobCancelledError";
  }
}

export type SourceType = "upload";

export type AnalysisJob = {
  id: string;
  source_type: SourceType;
  source_uri: string;
  original_filename: string | null;
  status: JobStatus;
  industry: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancel_requested: boolean;
};

export type ExtractionResult = {
  id: string;
  job_id: string;
  category_key: string;
  value: unknown;
  confidence: number | null;
  evidence: string | null;
  created_at: string;
};

export async function createJob(input: {
  source_type: SourceType;
  source_uri: string;
  original_filename?: string | null;
  created_by?: string | null;
}): Promise<AnalysisJob> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("analysis_jobs")
    .insert({
      source_type: input.source_type,
      source_uri: input.source_uri,
      original_filename: input.original_filename ?? null,
      created_by: input.created_by ?? null,
      status: "queued",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as AnalysisJob;
}

export async function updateJob(
  id: string,
  patch: Partial<
    Pick<
      AnalysisJob,
      "status" | "industry" | "error" | "completed_at" | "original_filename"
    >
  >
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("analysis_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function getJob(id: string): Promise<AnalysisJob | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("analysis_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as AnalysisJob) ?? null;
}

export async function listJobs(): Promise<AnalysisJob[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("analysis_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as AnalysisJob[];
}

export async function saveExtractionResults(
  jobId: string,
  rows: Array<{
    category_key: string;
    value: unknown;
    confidence?: number | null;
    evidence?: string | null;
  }>
): Promise<void> {
  const sb = supabaseAdmin();
  // 既存を消してから差し替え
  const del = await sb.from("extraction_results").delete().eq("job_id", jobId);
  if (del.error) throw del.error;
  if (rows.length === 0) return;
  const { error } = await sb.from("extraction_results").insert(
    rows.map((r) => ({
      job_id: jobId,
      category_key: r.category_key,
      value: r.value,
      confidence: r.confidence ?? null,
      evidence: r.evidence ?? null,
    }))
  );
  if (error) throw error;
}

export async function getExtractionResults(
  jobId: string
): Promise<ExtractionResult[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("extraction_results")
    .select("*")
    .eq("job_id", jobId);
  if (error) throw error;
  return (data ?? []) as ExtractionResult[];
}

export async function appendJobLog(
  jobId: string,
  message: string,
  level: LogLevel = "info"
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("job_logs")
    .insert({ job_id: jobId, level, message });
  if (error) {
    // ログ失敗は本体処理を止めない
    console.warn("[appendJobLog] insert failed:", error);
    return;
  }
  console.log(`[job:${jobId}] [${level}] ${message}`);
}

export async function getJobLogs(jobId: string): Promise<JobLog[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("job_logs")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as JobLog[];
}

export async function requestCancel(jobId: string): Promise<void> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  // 中断可能な状態なら即座に cancelled にしてしまう。
  // 並行して worker が動いていても、次のチェックポイントで JobCancelledError になって安全に抜ける。
  const { error } = await sb
    .from("analysis_jobs")
    .update({
      cancel_requested: true,
      status: "cancelled",
      completed_at: now,
      updated_at: now,
    })
    .eq("id", jobId)
    .in("status", [
      "queued",
      "downloading",
      "transcoding",
      "analyzing",
      "writing_sheet",
      "cancelling",
    ]);
  if (error) throw error;
}

/**
 * cancel_requested が true ならキャンセル状態に遷移させて throw する。
 * worker の各チェックポイントで呼び出す。
 */
export async function checkCancellation(jobId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("analysis_jobs")
    .select("cancel_requested")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (data?.cancel_requested) {
    await sb
      .from("analysis_jobs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    throw new JobCancelledError();
  }
}

export async function saveTranscript(
  jobId: string,
  fullText: string,
  segments: unknown
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("transcripts").upsert({
    job_id: jobId,
    full_text: fullText,
    segments,
  });
  if (error) throw error;
}

export async function getTranscript(
  jobId: string
): Promise<{ full_text: string; segments: unknown } | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("transcripts")
    .select("full_text, segments")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { full_text: data.full_text as string, segments: data.segments };
}
