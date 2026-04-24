import { CATEGORIES, type CategoryDef } from "@/config/categories";

export function buildExtractionPrompt(
  transcript: string,
  industry: string
): string {
  const catSpec = CATEGORIES.map((c) => formatCategory(c)).join("\n");
  return `
あなたは商談分析担当です。
判定済み業界: ${industry}
以下の商談文字起こしから、各カテゴリーの値を抽出してください。

【抽出ルール】
- 発話されていない/推定不能な項目は value を null にする
- 推測ではなく文字起こしに根拠がある内容のみ抽出する
- evidence_quote は文字起こし内の該当発話の引用（最大80文字）
- confidence は 0.0〜1.0 の自己評価

【カテゴリー定義】
${catSpec}

【出力JSON Schema】
{
  "results": {
    "<category_key>": { "value": ..., "evidence_quote": "...", "confidence": 0.0 }
  }
}

【文字起こし】
"""
${transcript}
"""
`.trim();
}

function formatCategory(c: CategoryDef): string {
  const opts = c.options ? `（候補: ${c.options.join(" / ")}）` : "";
  return `- ${c.key} (${c.label}, type=${c.type}${opts}): ${c.description}`;
}
