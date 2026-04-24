"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CATEGORIES } from "@/config/categories";

type Job = {
  id: string;
  source_type: string;
  source_uri: string;
  original_filename: string | null;
  status: string;
  industry: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

type Result = {
  category_key: string;
  value: unknown;
  confidence: number | null;
  evidence: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "待機中",
  downloading: "ダウンロード中",
  transcoding: "音声抽出中",
  analyzing: "AI解析中",
  writing_sheet: "シート書込中",
  done: "完了",
  failed: "失敗",
};

const TERMINAL = new Set(["done", "failed"]);

export function JobDetail({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [actionMsg, setActionMsg] = useState<string>("");

  useEffect(() => {
    let stopped = false;

    async function tick() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { job: Job; results: Result[] };
        if (stopped) return;
        setJob(data.job);
        setResults(data.results);
        if (TERMINAL.has(data.job.status)) {
          stopped = true;
        }
      } catch {
        /* ignore */
      }
    }

    tick();
    const t = setInterval(() => {
      if (!stopped) tick();
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [jobId]);

  async function rerun() {
    setActionMsg("再解析を依頼中…");
    const res = await fetch(`/api/jobs/${jobId}/rerun`, { method: "POST" });
    setActionMsg(res.ok ? "再解析を開始しました" : "再解析に失敗しました");
  }

  async function rewriteSheet() {
    setActionMsg("シートに書き込み中…");
    const res = await fetch(`/api/jobs/${jobId}/sheet`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setActionMsg(res.ok ? "シートに書き込みました" : `失敗: ${j.error ?? res.status}`);
  }

  if (!job) {
    return <p className="text-ink-muted">読み込み中…</p>;
  }

  const resultMap = new Map(results.map((r) => [r.category_key, r]));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/jobs" className="text-[13px] text-ink-muted hover:text-ink">
          ← ジョブ一覧
        </Link>
        <h1 className="text-[24px] font-semibold mt-2">
          {job.original_filename ?? "（URL指定ジョブ）"}
        </h1>
        <p className="text-[13px] text-ink-muted mt-1 tabular">
          作成 {new Date(job.created_at).toLocaleString("ja-JP")}
          {job.completed_at && (
            <>　 / 完了 {new Date(job.completed_at).toLocaleString("ja-JP")}</>
          )}
        </p>
      </div>

      <div className="bg-surface border border-border rounded-lg p-6 grid grid-cols-3 gap-6">
        <Field label="ステータス">
          <span
            className={
              job.status === "done"
                ? "text-success font-medium"
                : job.status === "failed"
                ? "text-danger font-medium"
                : "text-ink"
            }
          >
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
        </Field>
        <Field label="判定業界">{job.industry ?? "—"}</Field>
        <Field label="ソース">{job.source_type}</Field>
      </div>

      {job.error && (
        <div className="border border-danger/30 bg-danger/5 text-danger rounded-lg p-4 text-[13px]">
          <div className="font-medium mb-1">エラー</div>
          <pre className="whitespace-pre-wrap">{job.error}</pre>
        </div>
      )}

      <div>
        <h2 className="text-[18px] font-semibold mb-3">抽出結果</h2>
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-[14px]">
            <thead className="bg-surface-muted text-ink-muted text-[12px]">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-[200px]">項目</th>
                <th className="text-left px-4 py-2 font-medium">値</th>
                <th className="text-left px-4 py-2 font-medium w-[280px]">根拠</th>
                <th className="text-right px-4 py-2 font-medium w-[80px]">確度</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => {
                const r = resultMap.get(c.key);
                return (
                  <tr key={c.key} className="border-t border-border align-top">
                    <td className="px-4 py-3 text-ink-muted">{c.label}</td>
                    <td className="px-4 py-3">
                      {r?.value == null
                        ? "—"
                        : typeof r.value === "object"
                        ? JSON.stringify(r.value)
                        : String(r.value)}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-ink-subtle">
                      {r?.evidence ?? ""}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {r?.confidence != null ? r.confidence.toFixed(2) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={rerun}
          disabled={!TERMINAL.has(job.status)}
          className="h-[40px] px-4 text-[13px] rounded-md border border-border-strong bg-surface hover:bg-surface-muted disabled:opacity-50"
        >
          再解析
        </button>
        <button
          onClick={rewriteSheet}
          disabled={job.status !== "done" || !job.industry}
          className="h-[40px] px-4 text-[13px] rounded-md bg-primary text-white hover:bg-primary-dark disabled:opacity-50"
        >
          スプレッドシートへ書き込み
        </button>
        {actionMsg && <span className="text-[13px] text-ink-muted">{actionMsg}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-ink-muted mb-1">{label}</div>
      <div className="text-[14px]">{children}</div>
    </div>
  );
}
