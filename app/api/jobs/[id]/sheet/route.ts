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
  if (!job.industry)
    return NextResponse.json(
      { error: "業界が未判定のためシート書き込みできません" },
      { status: 400 }
    );

  const rows = await getExtractionResults(id);
  const extracted: ExtractionMap = {};
  for (const r of rows) {
    extracted[r.category_key] = {
      value: r.value,
      evidence_quote: r.evidence,
      confidence: r.confidence,
    };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  await upsertExtractionRow({
    jobId: id,
    filename: job.original_filename,
    industry: job.industry,
    extracted,
    evidenceUrl: appUrl ? `${appUrl}/jobs/${id}` : "",
  });

  return NextResponse.json({ ok: true });
}
