import { NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/db/jobs";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  await updateJob(id, { status: "queued", error: null });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const token = process.env.INTERNAL_API_TOKEN ?? "";
  fetch(`${appUrl}/api/worker/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": token,
    },
    body: JSON.stringify({ job_id: id }),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
