import { INDUSTRIES } from "@/config/categories";

export function buildIndustryPrompt(transcript: string): string {
  return `
あなたは商談分析担当です。以下の商談文字起こしから、顧客企業が属する業界を判定してください。

業界候補（必ずこの中から1つを選ぶ）:
${INDUSTRIES.map((x) => `- ${x}`).join("\n")}

出力JSON: {"industry": "<上記候補の文字列>", "industry_confidence": 0.0〜1.0, "summary": "100〜200字の商談サマリ"}

文字起こし:
"""
${transcript}
"""
`.trim();
}
