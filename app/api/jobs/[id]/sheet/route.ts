import { NextResponse } from "next/server";
import { getJob, getExtractionResults } from "@/lib/db/jobs";
import { upsertExtractionRow } from "@/lib/sheets/upsert";
import type { ExtractionMap } from "@/lib/ai/pipeline";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rows = await getExtractionResults(id);
  const extracted: ExtractionMap = {};
  for (const r of rows) {
    extracted[r.category_key] = {
      value: r.value,
      evidence_quote: r.evidence,
      confidence: r.confidence,
    };
  }

  await upsertExtractionRow({
    jobId: id,
    extracted,
  });

  return NextResponse.json({ ok: true });
}
