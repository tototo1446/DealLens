import { genai, MODEL_FLASH, MODEL_PRO } from "./gemini";
import { TRANSCRIBE_INSTRUCTION } from "./prompts/transcribe";
import { buildIndustryPrompt } from "./prompts/classify-industry";
import { buildExtractionPrompt } from "./prompts/extract-categories";

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

export type IndustryResult = {
  industry: string;
  industry_confidence: number;
  summary: string;
};

export type ExtractionMap = Record<
  string,
  { value: unknown; evidence_quote: string | null; confidence: number | null }
>;

/**
 * Stage 1: 音声 → 文字起こし + 話者分離
 */
export async function transcribeAudio(
  audioMp3: Buffer
): Promise<TranscriptResult> {
  const ai = genai();
  const result = await ai.models.generateContent({
    model: MODEL_FLASH,
    contents: [
      {
        role: "user",
        parts: [
          { text: TRANSCRIBE_INSTRUCTION },
          {
            inlineData: {
              mimeType: "audio/mpeg",
              data: audioMp3.toString("base64"),
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const text = result.text ?? "";
  return safeParse<TranscriptResult>(text, {
    segments: [],
    full_text: "",
  });
}

/**
 * Stage 2: 文字起こし → 業界判定 + サマリ
 */
export async function classifyIndustry(
  transcript: string
): Promise<IndustryResult> {
  const ai = genai();
  const result = await ai.models.generateContent({
    model: MODEL_FLASH,
    contents: [{ role: "user", parts: [{ text: buildIndustryPrompt(transcript) }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return safeParse<IndustryResult>(result.text ?? "", {
    industry: "その他",
    industry_confidence: 0,
    summary: "",
  });
}

/**
 * Stage 3: 文字起こし + 業界 → カテゴリー別構造化抽出
 */
export async function extractCategories(
  transcript: string,
  industry: string
): Promise<ExtractionMap> {
  const ai = genai();
  const result = await ai.models.generateContent({
    model: MODEL_PRO,
    contents: [
      { role: "user", parts: [{ text: buildExtractionPrompt(transcript, industry) }] },
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
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    // ```json ... ``` で囲まれているケースに対応
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try {
        return JSON.parse(m[1]) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}
