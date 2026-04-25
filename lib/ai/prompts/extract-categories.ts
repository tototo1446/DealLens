import { CATEGORIES, type CategoryDef } from "@/config/categories";

export function buildExtractionPrompt(transcript: string): string {
  const catSpec = CATEGORIES.map((c) => formatCategory(c)).join("\n");
  return `
あなたは顧客相談動画の分析担当です。
以下は商談・相談動画の文字起こしです。顧客(相談者)の発話を中心に、定義された各カテゴリーに該当する情報を抽出してください。

【抽出ルール】
- 発話されていない/推定不能な項目は value を null にする
- 推測ではなく、文字起こしに根拠がある内容のみ抽出する
- 数項目(印象的なフレーズなど)は原文の引用を尊重する
- evidence_quote は文字起こし内の該当発話の引用。**最大80文字**。それを超える場合は最も該当性が高い1発話だけを抜粋して切り詰める。複数の発話を連結したり、長い文脈を全部入れない。短く、ピンポイントで
- confidence は 0.0〜1.0 の自己評価
- 顧客本人の情報を優先。セールスマン側の情報を書くのは "セールスマンのアプローチ" "悩みに対するアプローチ評価" のみ
- "name" は『姓 名』のフルネームをカタカナで出力 (例: イシカワ マイ)。漢字や読み仮名から音をカタカナ化する。フルネームが揃っていない場合のみ null。決して漢字で出力しない

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
  const opts = c.options ? `(候補: ${c.options.join(" / ")})` : "";
  return `- ${c.key} (${c.label}, type=${c.type}${opts}): ${c.description}`;
}
