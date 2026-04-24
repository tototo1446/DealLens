import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const runtime = "nodejs";

/**
 * Vercel Blob Client Direct Upload のトークン発行エンドポイント
 * 4.5MB制限を回避するため、大きい動画はクライアントから直接Blobへ。
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // 内部利用前提なので拡張子のみチェック
        const ok = /\.(mp4|mov|m4a|mp3|webm|mkv|wav)$/i.test(pathname);
        if (!ok) throw new Error("対応していないファイル形式です");
        return {
          allowedContentTypes: [
            "video/mp4",
            "video/quicktime",
            "video/webm",
            "video/x-matroska",
            "audio/mpeg",
            "audio/mp4",
            "audio/wav",
            "application/octet-stream",
          ],
          maximumSizeInBytes: 5 * 1024 * 1024 * 1024, // 5GB
          tokenPayload: JSON.stringify({}),
        };
      },
      onUploadCompleted: async () => {
        // ここでDBに記録もできるが、ジョブ作成は /api/ingest で行う
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
