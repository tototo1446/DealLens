import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { runJobExtract } from "@/lib/worker/run-job";

export const runtime = "nodejs";
export const maxDuration = 800;

const Body = z.object({ job_id: z.string().uuid() });

/**
 * Phase B (カテゴリ抽出+シート書込) を Phase A から HTTP 経由で kick される
 * エンドポイント。新しい Vercel Function インスタンスとして起動するため、
 * Phase A とは独立した maxDuration 枠を持つ。
 */
export async function POST(req: Request): Promise<NextResponse> {
  const token = req.headers.get("x-internal-token");
  if (token !== process.env.INTERNAL_API_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json();
  const { job_id } = Body.parse(json);

  after(async () => {
    try {
      await runJobExtract(job_id);
    } catch (e) {
      console.error("[worker/extract] job failed", job_id, e);
    }
  });

  return NextResponse.json({ accepted: true, job_id });
}
