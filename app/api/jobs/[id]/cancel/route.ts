import { NextResponse } from "next/server";
import { getJob, requestCancel, appendJobLog } from "@/lib/db/jobs";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const terminal = ["done", "failed", "cancelled"];
  if (terminal.includes(job.status)) {
    return NextResponse.json(
      { error: "既に終了したジョブです" },
      { status: 400 }
    );
  }

  await requestCancel(id);
  await appendJobLog(id, "中断を実行しました (status=cancelled)", "warn");
  return NextResponse.json({ ok: true });
}
