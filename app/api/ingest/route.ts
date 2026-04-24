import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob } from "@/lib/db/jobs";
import { extractDriveFileId } from "@/lib/storage/drive";

export const runtime = "nodejs";

const Body = z.object({
  source_type: z.enum(["upload", "drive_url", "gigafile"]),
  source_uri: z.string().url(),
  original_filename: z.string().optional().nullable(),
  created_by: z.string().optional().nullable(),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const json = await req.json();
    const parsed = Body.parse(json);

    if (parsed.source_type === "drive_url" && !extractDriveFileId(parsed.source_uri)) {
      return NextResponse.json(
        { error: "Google DriveのURL形式を認識できませんでした" },
        { status: 400 }
      );
    }

    const job = await createJob({
      source_type: parsed.source_type,
      source_uri: parsed.source_uri,
      original_filename: parsed.original_filename ?? null,
      created_by: parsed.created_by ?? null,
    });

    // ワーカーを fire-and-forget で起動
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const token = process.env.INTERNAL_API_TOKEN ?? "";
    fetch(`${appUrl}/api/worker/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": token,
      },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(() => {
      // 失敗しても /api/worker/process を手動で叩けば再実行可能
    });

    return NextResponse.json({ job_id: job.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ingest failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
