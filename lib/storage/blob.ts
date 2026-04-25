import { put, del } from "@vercel/blob";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function putBuffer(
  pathname: string,
  data: Buffer,
  contentType?: string
): Promise<{ url: string; pathname: string }> {
  const blob = await put(pathname, data, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return { url: blob.url, pathname: blob.pathname };
}

export async function deleteBlob(url: string): Promise<void> {
  await del(url);
}

/**
 * 大容量動画 (数GB) をメモリに乗せず一時ファイルにストリーミング保存する。
 * arrayBuffer() で全部読むと Vercel Function のメモリ上限を超えてハングするため、
 * 必ずこのヘルパーを通す。返り値の dir は呼び出し側で rm して掃除する。
 */
export async function downloadToTempFile(
  url: string
): Promise<{ path: string; dir: string; bytes: number }> {
  const res = await fetch(url);
  if (!res.ok || !res.body)
    throw new Error(`fetch failed: ${res.status} ${url}`);
  const dir = await mkdtemp(join(tmpdir(), "dl-"));
  const path = join(dir, "input.bin");
  await pipeline(
    // Web ReadableStream → Node.js Readable に変換してファイルにパイプ
    Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path)
  );
  const { size } = await stat(path);
  return { path, dir, bytes: size };
}
