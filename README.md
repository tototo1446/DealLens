# 商談動画 解析ツール

商談録画動画をWebアプリでアップロード → Gemini で文字起こし・業界判定・カテゴリー抽出 → 業界別タブのGoogleスプレッドシートに追記する内部ツール。

実装計画: [`doc/implementation-plan.md`](./doc/implementation-plan.md)
元議事録: [`docs/議事録`](./docs/議事録)

## セットアップ

### 1. パッケージインストール

```bash
npm install
```

### 2. Supabase

1. プロジェクト作成
2. SQL Editor で `supabase/migrations/0001_init.sql` を実行
3. Project Settings → API から URL / anon / service_role を取得

### 3. Google Cloud（Gemini + Sheets）

- **Gemini API key**: https://aistudio.google.com/app/apikey
- **Sheets サービスアカウント**:
  1. GCP コンソール → サービスアカウント作成
  2. JSON キーを発行（`client_email` と `private_key` を取得）
  3. 書き込み先のスプレッドシートを `client_email` に「編集者」として共有

### 4. Vercel Blob

`@vercel/blob` の `BLOB_READ_WRITE_TOKEN` を Vercel Storage で発行。

### 5. 環境変数

`.env.example` を `.env.local` にコピーして埋める。

```bash
cp .env.example .env.local
```

| Key | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase接続 |
| `GOOGLE_API_KEY` | Gemini API |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Sheets書き込み |
| `TARGET_SPREADSHEET_ID` | 書き込み先スプレッドシートID |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob |
| `INTERNAL_API_TOKEN` | ワーカー保護用の任意トークン |
| `NEXT_PUBLIC_APP_URL` | デプロイURL（CronやHooksで使用） |

`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` は改行を `\n` でエスケープして1行で貼る。

### 6. 起動

```bash
npm run dev
```

`http://localhost:3000` を開く。

## 使い方

1. トップ画面でファイル直接アップロード or Google Drive 共有URLを貼る
2. 「解析を開始」を押すとジョブ詳細画面へ遷移、5秒間隔でステータスがポーリング更新される
3. 完了後、スプレッドシートの業界別タブに自動追記される
4. 結果が気になればプロンプト修正後「再解析」ボタンで再実行可能

## 構成

```
app/
  page.tsx                     アップロード画面
  jobs/page.tsx                ジョブ一覧
  jobs/[id]/page.tsx           ジョブ詳細
  api/upload/route.ts          Vercel Blob クライアント直接アップ用トークン
  api/ingest/route.ts          ジョブ作成 + ワーカー起動
  api/jobs/[id]/route.ts       ジョブ取得
  api/jobs/[id]/rerun/route.ts 再解析
  api/jobs/[id]/sheet/route.ts シート再書き込み
  api/worker/process/route.ts  非同期ジョブ実行（after()でバックグラウンド処理）
lib/
  ai/                          Gemini パイプライン（Stage1〜3）
  sheets/                      Google Sheets書き込み（業界別シート + UPSERT）
  storage/                     Vercel Blob / Google Drive
  ffmpeg/                      動画→音声抽出（fluent-ffmpeg + ffmpeg-static）
  worker/                      runJob オーケストレーション
  db/                          Supabase ラッパ
config/categories.ts           抽出カテゴリー定義（先方表が来たら差し替え）
supabase/migrations/           初期スキーマ
```

## 設計メモ

### 大容量動画への対応

- Vercel API Route の 4.5MB制限を回避するため、`@vercel/blob/client` の Client Direct Upload を採用
- ffmpeg で音声を 16kHz / mono / 64kbps mp3 に圧縮してから Gemini に投入（2時間動画でおおよそ60MB前後）
- ワーカーは `maxDuration = 800` + Fluid Compute 前提

### カテゴリー差し替え

`config/categories.ts` の `CATEGORIES` 配列を先方カテゴリー表で置き換えるだけでスプレッドシート列・抽出プロンプト・詳細画面が同期する。

### 業界別シート

`upsertExtractionRow` が業界名のシートタブを動的に作成し、`job_id` をキーに UPSERT する。

## 既知の制限

- ギガファイル便はスクレイピング寄りなので未対応。Drive 経由運用を推奨
- 動画のローカルキャッシュはしないため再解析時はBlob/Driveから再ダウンロードが発生
- Geminiの構造化出力ばらつきは `safeParse` でフォールバック吸収しているが、完全保証はしない
