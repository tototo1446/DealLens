import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";

export type AudioChunk = {
  buffer: Buffer;
  startSec: number;
};

/**
 * MP3 を chunkSec 秒ごとに分割する。
 * Gemini の MAX_TOKENS 制約を回避するため、長尺音声を細切れにして並列処理する用途。
 */
export async function splitAudioMp3(
  audioMp3: Buffer,
  chunkSec: number
): Promise<AudioChunk[]> {
  const ffmpegBin = (ffmpegStatic as unknown as string) ?? "ffmpeg";
  const dir = await mkdtemp(join(tmpdir(), "split-"));
  const inPath = join(dir, "input.mp3");

  try {
    await writeFile(inPath, audioMp3);

    await new Promise<void>((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        inPath,
        "-f",
        "segment",
        "-segment_time",
        String(chunkSec),
        "-c",
        "copy",
        "-reset_timestamps",
        "1",
        join(dir, "chunk-%04d.mp3"),
      ];
      const proc = spawn(ffmpegBin, args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else
          reject(new Error(`ffmpeg split exit ${code}: ${stderr.slice(-500)}`));
      });
    });

    const files = (await readdir(dir))
      .filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3"))
      .sort();

    const chunks: AudioChunk[] = [];
    for (let i = 0; i < files.length; i++) {
      const buffer = await readFile(join(dir, files[i]));
      chunks.push({ buffer, startSec: i * chunkSec });
    }
    return chunks;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
