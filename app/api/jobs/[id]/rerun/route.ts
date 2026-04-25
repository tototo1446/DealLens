import { NextResponse, after } from "next/server";
import { getJob, updateJob } from "@/lib/db/jobs";
import { runJob } from "@/lib/worker/run-job";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  await updateJob(id, { status: "queued", error: null });

  after(async () => {
    try {
      await runJob(id);
    } catch (e) {
      console.error("[api/jobs/rerun] runJob failed", id, e);
    }
  });

  return NextResponse.json({ ok: true });
}
