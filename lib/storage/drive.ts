/**
 * Google Drive 共有リンクからの直接ダウンロードヘルパ。
 * - Drive: 「リンクを知っている全員」に共有された URL を想定
 * - ギガファイル便: スクレイピングが必要なため初期はサポート外（手元で .mp4 を Drive に置く運用）
 */

const DRIVE_FILE_ID_PATTERNS: RegExp[] = [
  /\/file\/d\/([a-zA-Z0-9_-]+)/, // /file/d/<id>/view
  /[?&]id=([a-zA-Z0-9_-]+)/, // open?id=<id>
];

export function extractDriveFileId(url: string): string | null {
  for (const re of DRIVE_FILE_ID_PATTERNS) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

export function driveDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export async function fetchDriveFile(url: string): Promise<Buffer> {
  const id = extractDriveFileId(url);
  if (!id) throw new Error(`Driveのfile IDが取得できないURL: ${url}`);
  const dl = driveDownloadUrl(id);
  const res = await fetch(dl, { redirect: "follow" });
  if (!res.ok) throw new Error(`Driveダウンロード失敗: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
