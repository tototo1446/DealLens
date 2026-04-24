import Link from "next/link";
import { listJobs } from "@/lib/db/jobs";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  queued: "待機中",
  downloading: "ダウンロード中",
  transcoding: "音声抽出中",
  analyzing: "解析中",
  writing_sheet: "シート書込中",
  done: "完了",
  failed: "失敗",
};

const STATUS_COLOR: Record<string, string> = {
  done: "text-success",
  failed: "text-danger",
};

export default async function JobsPage() {
  const jobs = await listJobs();

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <h1 className="text-[24px] font-semibold">解析ジョブ一覧</h1>
        <Link
          href="/"
          className="h-[36px] inline-flex items-center px-4 text-[13px] rounded-md bg-primary text-white hover:bg-primary-dark"
        >
          新規アップロード
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-surface-muted text-ink-muted text-[12px]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">ファイル</th>
              <th className="text-left px-4 py-3 font-medium">業界</th>
              <th className="text-left px-4 py-3 font-medium">ステータス</th>
              <th className="text-left px-4 py-3 font-medium">作成日時</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-subtle">
                  まだジョブがありません
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-border">
                <td className="px-4 py-3 truncate max-w-[280px]">
                  {j.original_filename ?? <span className="text-ink-subtle">（URL指定）</span>}
                </td>
                <td className="px-4 py-3">
                  {j.industry ?? <span className="text-ink-subtle">—</span>}
                </td>
                <td className={`px-4 py-3 ${STATUS_COLOR[j.status] ?? ""}`}>
                  {STATUS_LABEL[j.status] ?? j.status}
                </td>
                <td className="px-4 py-3 tabular text-ink-muted text-[13px]">
                  {new Date(j.created_at).toLocaleString("ja-JP")}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/jobs/${j.id}`}
                    className="text-primary text-[13px] hover:underline"
                  >
                    詳細
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
