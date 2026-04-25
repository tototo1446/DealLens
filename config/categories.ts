/**
 * 顧客情報シートに転記する抽出カテゴリー定義
 *
 * key:    シート列名・抽出キーとして使う英数字スネークケース
 * label:  画面表示・スプレッドシートヘッダー
 * type:   "text" | "enum" | "number" | "boolean"
 * options: enum の場合の候補
 * description: AI に渡す抽出指示
 */

export type CategoryType = "text" | "enum" | "number" | "boolean";

export type CategoryDef = {
  key: string;
  label: string;
  type: CategoryType;
  options?: string[];
  description: string;
};

export const SHEET_TITLE = "顧客情報シート";

export const CATEGORIES: CategoryDef[] = [
  {
    key: "name",
    label: "名前",
    type: "text",
    description:
      "顧客本人の氏名を必ず『姓 名』のフルネーム + カタカナ表記で抽出する (例: イシカワ マイ)。" +
      "動画内では自己紹介でフルネームが述べられている前提。漢字が分かっていてもカタカナで出力すること (実際の表記が異なる可能性があるため)。" +
      "姓と名の間は半角スペース1つで区切る。" +
      "発話に含まれる読み仮名・名乗りからカタカナ化する。" +
      "姓のみ・名のみしか言及されていない場合は value を null にする (フルネームでない部分推定はしない)。",
  },
  {
    key: "age",
    label: "年齢",
    type: "text",
    description: "顧客の年齢。数値または「30代前半」などのレンジでも可。明示的に語られた情報のみ。",
  },
  {
    key: "occupation",
    label: "職業",
    type: "text",
    description: "顧客の職業・職種・業務内容。会社員/主婦/学生など含む。",
  },
  {
    key: "discovery_channel",
    label: "いつ私のことを知ったか／キッカケ",
    type: "text",
    description: "顧客が相手(セールスマン/相談者)をいつ・どこで知ったか、接点のキッカケ。SNS・紹介・広告など。",
  },
  {
    key: "pain_points",
    label: "顧客の悩み・課題",
    type: "text",
    description: "顧客が抱えている悩み・課題。過去の失敗経験・背景も含めて具体的に。箇条書き可。",
  },
  {
    key: "ideal_goal",
    label: "理想・ゴール",
    type: "text",
    description: "顧客が望む未来像、理想のゴール・状態。どうなりたいか。",
  },
  {
    key: "gap",
    label: "悩みと理想のギャップ",
    type: "text",
    description: "現状の悩みと理想のゴールの間にあるギャップ。何が足りていないのか。",
  },
  {
    key: "impressive_phrases",
    label: "印象的なフレーズ・感情がこもった言葉",
    type: "text",
    description: "顧客の発話で特に印象的なフレーズや感情が強く乗った言葉を原文に近い形で引用する。",
  },
  {
    key: "daily_behavior",
    label: "日常行動・生活背景",
    type: "text",
    description: "日常の時間の使い方、生活習慣、SNSの使い方・情報収集の仕方など、行動パターン。",
  },
  {
    key: "blockers",
    label: "行動を阻んでいる不安や理由",
    type: "text",
    description: "理想のゴールに向けて行動できない/踏み出せない不安・ブレーキ・心理的障壁。",
  },
  {
    key: "best_reactions",
    label: "相談中に最も反応が良かった話題・言葉",
    type: "text",
    description: "会話の中で顧客の反応が最も良かった話題・フレーズ・提案。共感や前のめりが見られた箇所。",
  },
  {
    key: "post_session_feeling",
    label: "相談後の感想・気持ちの変化",
    type: "text",
    description: "相談・商談の最後に顧客が述べた感想、気持ちの変化、ビフォーアフター。",
  },
  {
    key: "salesman_approach",
    label: "セールスマンのアプローチ",
    type: "text",
    description: "セールスマン/相談担当者が取ったアプローチ手法の要約。論理訴求/共感ベース/体験提案などの型や具体的な働きかけ。",
  },
  {
    key: "approach_evaluation",
    label: "悩みに対するアプローチ評価",
    type: "text",
    description: "セールスマンのアプローチが顧客の悩みにどれだけフィットしていたか、効果・改善点を含めた評価。",
  },
];
