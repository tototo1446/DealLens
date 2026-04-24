# 商談動画AI解析システム — 実装プラン

> Source: `docs/議事録`（2026-04-24 打ち合わせ）
> Owner: Manato
> Deadline: 2026-04-26（理想 4/25 中にプロトタイプ）

---

## 1. システム概要

Zoomなどの商談録画動画（最大2時間）をWebアプリ経由で取り込み、Gemini で内容を解析、先方定義の「顧客情報カテゴリー」に沿って構造化データを抽出、業界別シートに追記する内部ツール。

### スコープに含めないこと
- 凝ったUI/UX、認証、組織管理、課金
- 動画の長期保存（解析後は削除）
- 多言語対応（日本語想定）

---

## 2. 全体フロー

```
[ユーザー]
  ├─ A) Web画面で動画ファイル直接アップロード
  └─ B) Google Drive / ギガファイル便のURLを貼り付け
        │
        ▼
[Next.js API Route: /api/ingest]
  ├─ 一時保管（Vercel Blob または Supabase Storage）
  ├─ 解析ジョブをキュー登録（job_id 発行）
  └─ ジョブステータスを Supabase に記録
        │
        ▼
[非同期ワーカー]
  1. 音声抽出（ffmpeg）または Gemini に動画直接投入
  2. Gemini 2.x で文字起こし + カテゴリー抽出（マルチステージ）
     ├─ Stage 1: 文字起こし + 話者分離
     ├─ Stage 2: 業界判定
     └─ Stage 3: カテゴリー別の構造化抽出（JSON）
  3. 結果を Supabase に保存
  4. Google Sheets API で業界別シートに追記
  5. 一時ファイル削除
        │
        ▼
[ユーザーが画面で結果確認 + 再解析]
```

---

## 3. 技術スタック

| 領域 | 採用 | 理由 |
|---|---|---|
| Frontend | Next.js 14 App Router + TypeScript + Tailwind | グローバルCLAUDE.mdのデフォルト |
| UI | shadcn/ui 最小構成 | UIこだわり不要のため最低限のみ |
| Backend | Next.js API Routes | フロントと同居でサクッと |
| Storage（動画一時） | Vercel Blob | 2時間動画 ≒ 1〜2GB を想定。`upload()` のClient Direct Uploadで4.5MB制限を回避 |
| Job 状態管理 | Supabase Postgres | ジョブテーブル + 結果テーブル |
| ジョブ実行 | Vercel Functions（fluid compute, maxDuration=900s）+ ポーリング | Vercel Workflow でも可（後述） |
| AI | **Google Gemini 2.5 Pro / Flash**（動画ネイティブ対応） | 動画を直接渡せるので音声抽出不要。`@google/genai` |
| 文字起こし保険 | （必要なら）Whisper API / Speech-to-Text | Gemini で精度不足な場合のフォールバック |
| Sheets連携 | `googleapis` の Sheets v4 | サービスアカウント認証 |
| Deploy | Vercel | グローバルデフォルト |

### 動画長さに関する注意

- Gemini File API: 最大 ~2GB / 動画上限あり。2時間動画は事前に音声トラック抽出（mp3, 64kbps）で 60MB 程度に圧縮する選択肢が現実的
- 初期実装は **「音声抽出 → Gemini に音声 + 抽出指示プロンプトを投入」** ルートでまず動かす

---

## 4. データモデル（Supabase）

```sql
-- ジョブ管理
create table analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('upload','drive_url','gigafile')),
  source_uri text not null,
  original_filename text,
  status text not null default 'queued'
    check (status in ('queued','downloading','transcoding','analyzing','writing_sheet','done','failed')),
  industry text,                    -- Stage2 で判定された業界
  error text,
  created_by text,                  -- 内部ユーザー識別子（メアドで十分）
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

-- 抽出結果（カテゴリー単位の正規化版）
create table extraction_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references analysis_jobs(id) on delete cascade,
  category_key text not null,       -- カテゴリー表の key
  value jsonb not null,             -- 構造化された抽出値
  confidence numeric,
  evidence text,                    -- 根拠となる発話の引用
  created_at timestamptz default now()
);

-- 文字起こし全文（再解析用に保持）
create table transcripts (
  job_id uuid primary key references analysis_jobs(id) on delete cascade,
  full_text text not null,
  segments jsonb,                   -- [{start, end, speaker, text}]
  created_at timestamptz default now()
);
```

RLS は内部利用のため最小限。Service Role でのアクセスを想定。

---

## 5. 画面構成（最小）

### `/` — アップロード画面
- ファイル選択 or URL貼り付け
- 「解析開始」ボタン → `job_id` 発行 → `/jobs/[id]` へリダイレクト

### `/jobs/[id]` — ステータス + 結果
- 進捗表示（5秒ポーリング）
- 完了したら：
  - 業界判定結果
  - カテゴリー別の抽出値（テーブル）
  - スプレッドシートへのリンク
  - 「シートに書き込み直す」「再解析」ボタン

### `/jobs` — 一覧
- 過去の解析ジョブ一覧、業界フィルタ、ステータス

UI は shadcn/ui の Table / Card / Button のみで構成。装飾なし。

---

## 6. AI 解析プロンプト設計（マルチステージ）

> CLAUDE.md の「マルチステージ構成（分析→ルーティング→生成）」パターンに沿う

### Stage 1: 文字起こし + 話者分離
- 入力: 動画（または抽出済み音声）
- 出力: `[{start, end, speaker_label, text}]`
- モデル: Gemini 2.5 Flash（高速・安価）

### Stage 2: 業界判定 + サマリ
- 入力: 文字起こし全文
- 出力: `{industry: string, industry_confidence: number, summary: string}`
- 業界カンディデートは先方カテゴリー表から取得
- モデル: Gemini 2.5 Flash

### Stage 3: カテゴリー別構造化抽出
- 入力: 文字起こし + 業界 + カテゴリー定義（先方提供）
- 出力: `{[category_key]: {value, evidence_quote, confidence}}`
- **`responseSchema` で構造化出力を強制**（JSON Schema）
- モデル: Gemini 2.5 Pro（精度重視）

カテゴリー表が未着のため、初期実装は「ダミーカテゴリー（業種・規模・課題・予算感・意思決定者・導入時期 など）」で先行実装。表が来たら定義ファイル（`config/categories.ts`）を差し替えるだけにする。

---

## 7. Google Sheets 連携

### 認証
- サービスアカウント方式
- Sheets ID は環境変数 `TARGET_SPREADSHEET_ID`
- 業界ごとにシートタブを動的作成（無ければ追加）

### 書き込み形式
1行 = 1商談。列はカテゴリー + メタ情報。

```
| job_id | 解析日時 | 動画ファイル名 | 業界 | カテゴリーA | カテゴリーB | ... | エビデンスURL |
```

エビデンスURLは `/jobs/[id]` への内部リンク。

### 重複対策
- `job_id` 列で UPSERT（既存行があれば更新、無ければ追加）

---

## 8. 環境変数

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google AI
GOOGLE_API_KEY=                    # Gemini

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
TARGET_SPREADSHEET_ID=

# Vercel Blob
BLOB_READ_WRITE_TOKEN=

# Drive ダウンロード（オプション、Drive直連携する場合）
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON=

# App
NEXT_PUBLIC_APP_URL=
INTERNAL_API_TOKEN=                # 内部API保護
```

---

## 9. ディレクトリ構成（案）

```
app/
  page.tsx                       # アップロード画面
  jobs/
    page.tsx                     # 一覧
    [id]/page.tsx                # 詳細
  api/
    ingest/route.ts              # ファイル/URL受付 + job作成
    jobs/[id]/route.ts           # ステータス取得
    jobs/[id]/rerun/route.ts     # 再解析
    jobs/[id]/sheet/route.ts     # シート書き込み
    worker/process/route.ts      # 内部用 ジョブ実行エンドポイント
lib/
  ai/
    gemini.ts                    # Gemini クライアント
    pipeline.ts                  # Stage1〜3 のオーケストレーション
    prompts/
      transcribe.ts
      classify-industry.ts
      extract-categories.ts
  sheets/
    client.ts                    # Google Sheets API ラッパ
    upsert.ts                    # 業界別シートへの追記/更新
  storage/
    blob.ts                      # Vercel Blob
    drive.ts                     # Drive URL からのダウンロード
  ffmpeg/
    extract-audio.ts             # 音声抽出（fluent-ffmpeg）
  db/
    supabase.ts
    jobs.ts
config/
  categories.ts                  # 先方カテゴリー定義（差し替え想定）
```

---

## 10. 実装ステップ（時系列・推定工数）

### Day 1 (4/25)
- [ ] **0.5h** リポジトリ初期化、Vercel/Supabase 紐付け、env投入
- [ ] **0.5h** Supabase テーブル作成（上記スキーマ）
- [ ] **1h** アップロードUI + Vercel Blob のClient Direct Upload
- [ ] **1h** ジョブ作成API + ステータス取得API
- [ ] **0.5h** ジョブ詳細画面（ポーリング表示）
- [ ] **2h** Gemini パイプライン実装（ダミーカテゴリーで Stage1〜3）
- [ ] **1h** ffmpeg 音声抽出（Vercel Functions 上で動く形 / または `ffmpeg-static`）
- [ ] **1h** Google Sheets サービスアカウント設定 + 書き込みロジック
- [ ] **0.5h** 通しでサンプル動画1本流して結果確認

→ 4/25 夜にプロトタイプ完成、先方サンプル動画が来た段階で実データ検証

### Day 2 (4/26)
- [ ] 先方カテゴリー表を `config/categories.ts` に反映
- [ ] サンプル動画3本で精度検証、プロンプト調整
- [ ] 業界別シート分けロジックの動作確認
- [ ] エラーハンドリング強化（リトライ、失敗ジョブの再実行UI）
- [ ] 先方共有

---

## 11. 技術的な要注意ポイント

### a) 大容量動画の扱い
- Vercel API Route はリクエストボディ4.5MB制限 → **必ず Client Direct Upload**（`@vercel/blob/client`）
- Function タイムアウトは Fluid Compute で 900秒だが、2時間動画の解析は超える可能性あり → **音声抽出して投入** + Stage を分けて細切れに実行
- 音声抽出は ffmpeg。Vercel Functions では `ffmpeg-static` を含めるか、別途 Vercel Sandbox / 外部処理を検討

### b) Drive / ギガファイル便ダウンロード
- ギガファイル便はスクレイピング寄りになる → 初期は **Drive サービスアカウント共有方式を推奨**
- Drive URL から直接ダウンロード → Blob に転送 → 解析

### c) Gemini の構造化出力
- `responseMimeType: "application/json"` + `responseSchema` でカテゴリー揺れを防ぐ
- 抽出値には必ず `evidence_quote` を含めて、シート上で根拠が辿れるようにする

### d) 日時処理（CLAUDE.md教訓）
- 商談日時はメタとして必要に応じて `datetime-local` ではなく ISO 文字列で扱う
- 表示時はJSTに変換

### e) Vercel Cron / 非同期
- 今回はユーザーが画面で待つのでCron不要
- ジョブ起動は API Route で fire-and-forget（`waitUntil`）

---

## 12. リスクと未確定事項

| 項目 | リスク | 対応 |
|---|---|---|
| 先方カテゴリー表未着 | 抽出設計が確定できない | ダミーで先行、差し替え前提のconfig分離 |
| サンプル動画未着 | プロンプト調整できない | パブリックな商談風動画で代用検証 |
| 2時間動画のGemini処理時間 | タイムアウト・コスト | 音声抽出 + チャンク分割で対応、最悪Whisper併用 |
| ベンダー登録停滞 | 本番アカウント発行遅延 | 個人/チームのVercel + GoogleアカウントでPoC優先 |
| 伊藤様体調不良による意思決定遅延 | 仕様確認が止まる | こちらは想定で先行実装し、合流次第すり合わせ |

---

## 13. 先方への確認事項（カテゴリー表が来たら同時に確認したい）

1. 業界の粒度（大分類だけ？業種コード？）
2. カテゴリー値の型（自由記述 / 列挙値 / 数値）
3. 1商談 = 1行 で良いか（複数フェーズある場合は？）
4. 既存スプレッドシートの列順を維持する必要があるか
5. 動画は解析後削除して良いか（保存ポリシー）
6. 内部ツールへのアクセス制御（社内IPのみ？Basic認証？）

---

## 14. 完了基準（先方に渡す時点）

- [ ] サンプル動画3本それぞれで解析が完走すること
- [ ] 指定スプレッドシートに業界別タブで結果が追記されていること
- [ ] エビデンス（発話引用）から動画内容が辿れること
- [ ] 失敗時に画面で原因が確認でき、再実行できること
