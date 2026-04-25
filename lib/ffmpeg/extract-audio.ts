import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";

/**
 * 動画 (Buffer / ローカルパス / HTTPS URL) から mp3 音声を抽出する。
 * Gemini の音声入力サイズ削減のため 64kbps モノラルに圧縮。
 *
 * 大容量 (数GB) は URL 渡しを推奨: ffmpeg が直接ネットワークから
 * 必要な範囲だけストリーミング読み込みするため /tmp 容量を消費しない。
 * Vercel Function の /tmp 上限を回避できる。
 */
export async function extractAudioMp3(
  input: Buffer | string
): Promise<Buffer> {
  const ffmpegBin = (ffmpegStatic as unknown as string) ?? "ffmpeg";
  const dir = await mkdtemp(join(tmpdir(), "vid-"));
  const outPath = join(dir, "out.mp3");

  let inPath: string;
  if (typeof input === "string") {
    inPath = input;
  } else {
    inPath = join(dir, "input.bin");
    await writeFile(inPath, input);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        inPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        outPath,
      ];
      const proc = spawn(ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
      });
    });

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
