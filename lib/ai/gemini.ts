import { GoogleGenAI } from "@google/genai";

let cached: GoogleGenAI | null = null;

export function genai(): GoogleGenAI {
  if (cached) return cached;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
  cached = new GoogleGenAI({ apiKey });
  return cached;
}

export const MODEL_FLASH = "gemini-2.5-flash";
export const MODEL_PRO = "gemini-2.5-pro";
