import { callGas } from "./client";
import { CATEGORIES, SHEET_TITLE } from "@/config/categories";
import type { ExtractionMap } from "@/lib/ai/pipeline";

function headerRow(): string[] {
  return CATEGORIES.map((c) => c.label);
}

function buildRow(extracted: ExtractionMap): string[] {
  return CATEGORIES.map((c) => {
    const v = extracted[c.key]?.value;
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}

/**
 * 顧客情報シート(固定名)に 1行 upsert する。
 * job_id を突合キーとして GAS 側で管理しているため、
 * 見かけ上はヘッダー14列のみだがメタ列は GAS のスクリプトプロパティで管理する。
 *
 * 現状は常に append とし、再解析は「再解析」ボタンで新しい行を追記する方針。
 */
export async function upsertExtractionRow(input: {
  jobId: string;
  extracted: ExtractionMap;
}): Promise<void> {
  await callGas("upsert", {
    sheetTitle: SHEET_TITLE,
    headerRow: headerRow(),
    jobId: input.jobId,
    row: buildRow(input.extracted),
  });
}
