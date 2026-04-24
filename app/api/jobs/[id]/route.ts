import { NextResponse } from "next/server";
import { getJob, getExtractionResults } from "@/lib/db/jobs";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const results = await getExtractionResults(id);
  return NextResponse.json({ job, results });
}
