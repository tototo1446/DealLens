import { callGas } from "./client";
import { CATEGORIES } from "@/config/categories";
import type { ExtractionMap } from "@/lib/ai/pipeline";

const META_HEADERS = ["job_id", "解析日時", "ファイル名", "業界"] as const;
const TAIL_HEADERS = ["evidence_url"] as const;

function headerRow(): string[] {
  return [
    ...META_HEADERS,
    ...CATEGORIES.map((c) => c.label),
    ...TAIL_HEADERS,
  ];
}

function buildRow(input: {
  jobId: string;
  filename: string | null;
  industry: string;
  extracted: ExtractionMap;
  evidenceUrl: string;
}): string[] {
  const meta = [
    input.jobId,
    new Date().toISOString(),
    input.filename ?? "",
    input.industry,
  ];
  const cats = CATEGORIES.map((c) => {
    const v = input.extracted[c.key]?.value;
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
  return [...meta, ...cats, input.evidenceUrl];
}

/**
 * 業界別シートに 1行 upsert(job_id 一致行があれば更新、無ければ追加)
 * 実処理は GAS Web App に委譲する
 */
export async function upsertExtractionRow(input: {
  jobId: string;
  filename: string | null;
  industry: string;
  extracted: ExtractionMap;
  evidenceUrl: string;
}): Promise<void> {
  const sheetTitle = input.industry || "未分類";
  await callGas("upsert", {
    sheetTitle,
    headerRow: headerRow(),
    jobId: input.jobId,
    row: buildRow(input),
  });
}
