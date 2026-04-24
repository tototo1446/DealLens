import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { runJob } from "@/lib/worker/run-job";

export const runtime = "nodejs";
export const maxDuration = 800; // Pro/Enterprise + Fluid Compute 上限

const Body = z.object({ job_id: z.string().uuid() });

export async function POST(req: Request): Promise<NextResponse> {
  const token = req.headers.get("x-internal-token");
  if (token !== process.env.INTERNAL_API_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json();
  const { job_id } = Body.parse(json);

  // 即座に応答を返してバックグラウンドで実行
  after(async () => {
    try {
      await runJob(job_id);
    } catch (e) {
      console.error("[worker] job failed", job_id, e);
    }
  });

  return NextResponse.json({ accepted: true, job_id });
}
