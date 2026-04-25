import { NextResponse, after } from "next/server";
import { z } from "zod";
import { createJob } from "@/lib/db/jobs";
import { runJob } from "@/lib/worker/run-job";

export const runtime = "nodejs";
// runJob は最大で動画DL+音声抽出+Gemini文字起こし+抽出+シート書込で 10 分超える。
// Pro/Enterprise + Fluid Compute 上限の 800s に合わせる。
export const maxDuration = 800;

const Body = z.object({
  source_type: z.literal("upload"),
  source_uri: z.string().url(),
  original_filename: z.string().optional().nullable(),
  created_by: z.string().optional().nullable(),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const json = await req.json();
    const parsed = Body.parse(json);

    const job = await createJob({
      source_type: parsed.source_type,
      source_uri: parsed.source_uri,
      original_filename: parsed.original_filename ?? null,
      created_by: parsed.created_by ?? null,
    });

    // レスポンス返却後にバックグラウンドで runJob を実行する。
    // Vercel Serverless では fetch().catch() の fire-and-forget は response 返却で
    // プロセスが kill されて送信前に消えるため、必ず after() でラップする。
    after(async () => {
      try {
        await runJob(job.id);
      } catch (e) {
        console.error("[api/ingest] runJob failed", job.id, e);
      }
    });

    return NextResponse.json({ job_id: job.id });
  } catch (e) {
    console.error("[api/ingest] error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: msg, stack: e instanceof Error ? e.stack : undefined },
      { status: 400 }
    );
  }
}
