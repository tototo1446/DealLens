import { genai, MODEL_FLASH, MODEL_PRO } from "./gemini";
import { TRANSCRIBE_INSTRUCTION } from "./prompts/transcribe";
import { buildExtractionPrompt } from "./prompts/extract-categories";
import { splitAudioMp3 } from "@/lib/ffmpeg/split-audio";

export type TranscriptSegment = {
  start: string;
  end: string;
  speaker: string;
  text: string;
};

export type TranscriptResult = {
  segments: TranscriptSegment[];
  full_text: string;
};

export type TranscriptDiagnostics = {
  finishReason?: string;
  promptTokens?: number;
  outputTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
  rawTextLength: number;
  rawTextHead: string;
  parseError?: string;
  blockReason?: string;
  safetyRatings?: string;
};

export type TranscriptOutcome = {
  result: TranscriptResult;
  diagnostics: TranscriptDiagnostics;
};

export type ExtractionMap = Record<
  string,
  { value: unknown; evidence_quote: string | null; confidence: number | null }
>;

/**
 * Stage 1: 音声 → 文字起こし + 話者分離
 *
 * Gemini の inlineData は ~20MB が上限のため、大きな音声は Files API でアップロードしてから参照する。
 */
export async function transcribeAudio(
  audioMp3: Buffer
): Promise<TranscriptOutcome> {
  const ai = genai();

  // Buffer → Blob → Files API にアップロード
  const blob = new Blob([new Uint8Array(audioMp3)], { type: "audio/mpeg" });
  let uploaded = await ai.files.upload({
    file: blob,
    config: { mimeType: "audio/mpeg" },
  });

  // ACTIVE になるまで待機 (最大 5 分)
  const deadline = Date.now() + 5 * 60 * 1000;
  while (uploaded.state === "PROCESSING") {
    if (Date.now() > deadline) {
      throw new Error("Gemini Files API: ファイルが ACTIVE になりませんでした");
    }
    await new Promise((r) => setTimeout(r, 2000));
    uploaded = await ai.files.get({ name: uploaded.name ?? "" });
  }

  if (uploaded.state !== "ACTIVE" || !uploaded.uri || !uploaded.mimeType) {
    throw new Error(
      `Gemini Files API: アップロード失敗 (state=${uploaded.state})`
    );
  }

  try {
    const result = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents: [
        {
          role: "user",
          parts: [
            { text: TRANSCRIBE_INSTRUCTION },
            { fileData: { mimeType: uploaded.mimeType, fileUri: uploaded.uri } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
        // 50分超の商談では JSON 全文が膨大になるため上限を引き上げる。
        // gemini-2.5-flash の上限は 65,535。デフォルト(8192)だと途中で MAX_TOKENS で
        // 切れて invalid JSON になり safeParse がフォールバックする (= 0文字) 原因。
        maxOutputTokens: 65535,
        // 文字起こしは推論不要。thinking ON だと出力枠を thoughts が食って
        // 本文が空になるケースがあるため明示的に DISABLED (=0)。
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const rawText = result.text ?? "";
    const candidate = result.candidates?.[0];
    const usage = (result as unknown as { usageMetadata?: Record<string, number> })
      .usageMetadata;
    const promptFeedback = (
      result as unknown as {
        promptFeedback?: { blockReason?: string; safetyRatings?: unknown };
      }
    ).promptFeedback;

    const diagnostics: TranscriptDiagnostics = {
      finishReason: candidate?.finishReason as string | undefined,
      promptTokens: usage?.promptTokenCount,
      outputTokens: usage?.candidatesTokenCount,
      thoughtsTokens: usage?.thoughtsTokenCount,
      totalTokens: usage?.totalTokenCount,
      rawTextLength: rawText.length,
      rawTextHead: rawText.slice(0, 240),
      blockReason: promptFeedback?.blockReason,
      safetyRatings: promptFeedback?.safetyRatings
        ? JSON.stringify(promptFeedback.safetyRatings).slice(0, 200)
        : undefined,
    };

    const parsed = safeParseWithError<TranscriptResult>(rawText, {
      segments: [],
      full_text: "",
    });
    if (parsed.error) diagnostics.parseError = parsed.error;

    return { result: parsed.value, diagnostics };
  } finally {
    if (uploaded.name) {
      await ai.files.delete({ name: uploaded.name }).catch(() => {});
    }
  }
}

/**
 * 長尺音声をチャンク分割して並列に文字起こしする。
 * 1リクエスト = 1チャンク にすることで gemini-2.5-flash の MAX_TOKENS (65535) に
 * 当たって JSON が壊れる問題を回避する。
 */
export async function transcribeAudioChunked(
  audioMp3: Buffer,
  options: {
    chunkSec?: number;
    concurrency?: number;
    onProgress?: (msg: string) => Promise<void> | void;
  } = {}
): Promise<TranscriptOutcome> {
  const chunkSec = options.chunkSec ?? 600; // 10 min
  const concurrency = options.concurrency ?? 3;
  const onProgress = options.onProgress;

  const chunks = await splitAudioMp3(audioMp3, chunkSec);
  if (chunks.length === 0) {
    throw new Error("音声を分割できませんでした (チャンク数=0)");
  }
  if (chunks.length === 1) {
    return transcribeAudio(audioMp3);
  }

  if (onProgress)
    await onProgress(
      `音声を ${chunks.length} 個のチャンク (各 ${chunkSec}s) に分割しました`
    );

  // 並列実行 (concurrency で制限)
  type ChunkResult = {
    index: number;
    startSec: number;
    outcome: TranscriptOutcome;
  };
  const results: ChunkResult[] = new Array(chunks.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= chunks.length) return;
      const ch = chunks[i];
      const outcome = await transcribeChunkWithRetry(ch.buffer, {
        attempts: 2,
        timeoutMs: 8 * 60 * 1000, // 8 min
        onAttemptFail: async (attempt, err) => {
          if (onProgress)
            await onProgress(
              `チャンク idx=${i} 試行${attempt}失敗 → リトライします: ${err}`
            );
        },
      });
      results[i] = { index: i, startSec: ch.startSec, outcome };
      completed++;
      if (onProgress)
        await onProgress(
          `チャンク ${completed}/${chunks.length} 完了 ` +
            `(idx=${i}, ${outcome.result.segments.length}seg, ` +
            `finishReason=${outcome.diagnostics.finishReason ?? "?"})`
        );
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, chunks.length) },
    () => worker()
  );
  await Promise.all(workers);

  // タイムスタンプにオフセット加算して結合
  const allSegments: TranscriptSegment[] = [];
  for (const r of results) {
    for (const seg of r.outcome.result.segments) {
      allSegments.push({
        start: shiftMmSs(seg.start, r.startSec),
        end: shiftMmSs(seg.end, r.startSec),
        speaker: seg.speaker,
        text: seg.text,
      });
    }
  }

  const full_text = allSegments
    .map((s) => `[${s.start}] ${s.speaker}: ${s.text}`)
    .join("\n");

  // 診断は集約
  const diag = aggregateDiagnostics(results.map((r) => r.outcome.diagnostics));

  return {
    result: { segments: allSegments, full_text },
    diagnostics: diag,
  };
}

/**
 * 1チャンクの文字起こしをタイムアウト付きで実行し、失敗時はリトライする。
 * Gemini Flash がループや hang で return しないケース対策。
 */
async function transcribeChunkWithRetry(
  buffer: Buffer,
  opts: {
    attempts: number;
    timeoutMs: number;
    onAttemptFail?: (attempt: number, err: string) => Promise<void> | void;
  }
): Promise<TranscriptOutcome> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await withTimeout(
        transcribeAudio(buffer),
        opts.timeoutMs,
        `chunk transcribe attempt ${attempt}`
      );
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < opts.attempts) {
        if (opts.onAttemptFail) await opts.onAttemptFail(attempt, msg);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw lastErr;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timeout after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function shiftMmSs(mmss: string, offsetSec: number): string {
  const parts = mmss.split(":").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return mmss;
  let totalSec: number;
  if (parts.length === 2) totalSec = parts[0] * 60 + parts[1];
  else if (parts.length === 3)
    totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else return mmss;
  const t = totalSec + offsetSec;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
      s
    ).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function aggregateDiagnostics(
  list: TranscriptDiagnostics[]
): TranscriptDiagnostics {
  const sum = (key: keyof TranscriptDiagnostics) =>
    list.reduce((acc, d) => acc + ((d[key] as number | undefined) ?? 0), 0);
  const finishReasons = list.map((d) => d.finishReason ?? "?").join(",");
  const errors = list
    .map((d, i) => (d.parseError ? `[${i}]${d.parseError}` : null))
    .filter(Boolean)
    .join(" | ");
  return {
    finishReason: finishReasons,
    promptTokens: sum("promptTokens"),
    outputTokens: sum("outputTokens"),
    thoughtsTokens: sum("thoughtsTokens"),
    totalTokens: sum("totalTokens"),
    rawTextLength: sum("rawTextLength"),
    rawTextHead: list[0]?.rawTextHead ?? "",
    parseError: errors || undefined,
    blockReason: list.find((d) => d.blockReason)?.blockReason,
    safetyRatings: list.find((d) => d.safetyRatings)?.safetyRatings,
  };
}

/**
 * Stage 2: 文字起こし → カテゴリー別構造化抽出
 */
export async function extractCategories(
  transcript: string
): Promise<ExtractionMap> {
  const ai = genai();
  const result = await ai.models.generateContent({
    model: MODEL_PRO,
    contents: [
      { role: "user", parts: [{ text: buildExtractionPrompt(transcript) }] },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const parsed = safeParse<{ results: ExtractionMap }>(result.text ?? "", {
    results: {},
  });
  return parsed.results ?? {};
}

function safeParse<T>(text: string, fallback: T): T {
  return safeParseWithError(text, fallback).value;
}

function safeParseWithError<T>(
  text: string,
  fallback: T
): { value: T; error?: string } {
  if (!text) return { value: fallback, error: "empty response" };
  try {
    return { value: JSON.parse(text) as T };
  } catch (e) {
    // ```json ... ``` で囲まれているケースに対応
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try {
        return { value: JSON.parse(m[1]) as T };
      } catch (e2) {
        return { value: fallback, error: errMsg(e2) };
      }
    }
    return { value: fallback, error: errMsg(e) };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
