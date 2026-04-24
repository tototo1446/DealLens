/**
 * 抽出カテゴリー定義（先方カテゴリー表が到着次第ここを差し替える）
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

export const INDUSTRIES: string[] = [
  "製造業",
  "小売・EC",
  "金融・保険",
  "医療・ヘルスケア",
  "不動産・建設",
  "教育",
  "IT・SaaS",
  "広告・マーケティング",
  "人材・HR",
  "公共・自治体",
  "その他",
];

export const CATEGORIES: CategoryDef[] = [
  {
    key: "company_name",
    label: "会社名",
    type: "text",
    description: "顧客企業の正式社名。明示的に発話されたものを抽出する。",
  },
  {
    key: "company_size",
    label: "企業規模",
    type: "enum",
    options: ["〜50名", "50〜300名", "300〜1000名", "1000名以上", "不明"],
    description: "従業員数のレンジを推定する。発話されていなければ「不明」。",
  },
  {
    key: "decision_maker",
    label: "意思決定者",
    type: "text",
    description: "今回の案件の意思決定権者の役職・部署名。",
  },
  {
    key: "current_pain",
    label: "現状の課題",
    type: "text",
    description: "顧客が口にした業務上の課題・困りごと。複数あれば箇条書きで。",
  },
  {
    key: "ai_use_case",
    label: "想定AI活用シーン",
    type: "text",
    description: "顧客が想定している/興味を示したAI活用ユースケース。",
  },
  {
    key: "budget_range",
    label: "予算感",
    type: "enum",
    options: ["〜50万", "50〜200万", "200〜500万", "500万〜", "未確認"],
    description: "顧客が口にした予算規模、または間接的に示唆された範囲。",
  },
  {
    key: "deployment_timing",
    label: "導入希望時期",
    type: "text",
    description: "導入希望時期。年月や四半期で具体的に。",
  },
  {
    key: "competitors_mentioned",
    label: "言及された他社・競合",
    type: "text",
    description: "比較検討中の他社サービス名、または以前検討した製品名。",
  },
  {
    key: "next_action",
    label: "次回ネクストアクション",
    type: "text",
    description: "商談クロージング時に合意されたネクストアクション。",
  },
  {
    key: "deal_temperature",
    label: "案件温度感",
    type: "enum",
    options: ["熱い", "中", "低い", "判断不能"],
    description:
      "顧客の前向き度合いを発話のニュアンス・質問の具体性から判定する。",
  },
];
