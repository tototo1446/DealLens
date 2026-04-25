"use client";

import { useEffect, useRef, useState } from "react";
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
  updated_at: string;
  completed_at: string | null;
};

type Result = {
  category_key: string;
  value: unknown;
  confidence: number | null;
  evidence: string | null;
};

type JobLog = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
};

type StepKey =
  | "queued"
  | "downloading"
  | "transcoding"
  | "analyzing"
  | "writing_sheet"
  | "done";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "queued", label: "待機" },
  { key: "downloading", label: "ダウンロード" },
  { key: "transcoding", label: "音声抽出" },
  { key: "analyzing", label: "AI解析" },
  { key: "writing_sheet", label: "シート書込" },
  { key: "done", label: "完了" },
];

const STEP_INDEX: Record<string, number> = Object.fromEntries(
  STEPS.map((s, i) => [s.key, i])
);

const TERMINAL = new Set(["done", "failed", "cancelled"]);

export function JobDetail({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [actionMsg, setActionMsg] = useState<string>("");
  const [now, setNow] = useState<number>(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function tick() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          job: Job;
          results: Result[];
          logs: JobLog[];
        };
        if (stoppedRef.current) return;
        setJob(data.job);
        setResults(data.results);
        setLogs(data.logs ?? []);
        if (TERMINAL.has(data.job.status)) {
          stoppedRef.current = true;
        }
      } catch {
        /* ignore */
      }
    }

    tick();
    const pollId = setInterval(() => {
      if (!stoppedRef.current) tick();
    }, 3000);
    const clockId = setInterval(() => {
      if (!stoppedRef.current) setNow(Date.now());
    }, 1000);
    return () => {
      stoppedRef.current = true;
      clearInterval(pollId);
      clearInterval(clockId);
    };
  }, [jobId]);

  async function rerun() {
    setActionMsg("再解析を依頼中…");
    const res = await fetch(`/api/jobs/${jobId}/rerun`, { method: "POST" });
    setActionMsg(res.ok ? "再解析を開始しました" : "再解析に失敗しました");
    if (res.ok) stoppedRef.current = false;
  }

  async function rewriteSheet() {
    setActionMsg("シートに書き込み中…");
    const res = await fetch(`/api/jobs/${jobId}/sheet`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setActionMsg(res.ok ? "シートに書き込みました" : `失敗: ${j.error ?? res.status}`);
  }

  async function cancel() {
    if (!confirm("このジョブを中断しますか?")) return;
    setCancelling(true);
    setActionMsg("中断中…");
    const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setActionMsg(res.ok ? "中断しました" : `中断失敗: ${j.error ?? res.status}`);
    setCancelling(false);
  }

  if (!job) {
    return <p className="text-ink-muted">読み込み中…</p>;
  }

  const resultMap = new Map(results.map((r) => [r.category_key, r]));
  const elapsed = getElapsedSeconds(job, now);
  const currentStep = STEP_INDEX[job.status] ?? -1;
  const isFailed = job.status === "failed";
  const isCancelled = job.status === "cancelled";
  const isCancelling = job.status === "cancelling";
  // cancelling (ゾンビ化した過去の中断要求) でも押して強制停止できるようにする
  const canCancel = !TERMINAL.has(job.status);

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

      <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
        <div className="grid grid-cols-3 gap-6">
          <Field label="ステータス">
            <StatusText status={job.status} />
          </Field>
          <Field label="ソース">{job.source_type}</Field>
          <Field label="経過時間">
            <span className="tabular">{formatDuration(elapsed)}</span>
          </Field>
        </div>

        <Stepper currentStep={currentStep} failed={isFailed || isCancelled} />
      </div>

      {isCancelling && (
        <div className="border border-warning/30 bg-warning/5 rounded-lg p-4 text-[13px] text-ink flex items-start gap-3">
          <span className="mt-[3px]">
            <Spinner />
          </span>
          <div>
            <div className="font-medium text-warning mb-1">旧バージョンの中断リクエスト残存</div>
            <p className="text-ink-muted">
              過去に残された cancelling 状態のジョブです。もう一度「中断」ボタンを押すと即座に停止状態(cancelled)に遷移します。
            </p>
          </div>
        </div>
      )}

      <LogTimeline logs={logs} isRunning={!TERMINAL.has(job.status)} />

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

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={rerun}
          disabled={!TERMINAL.has(job.status)}
          className="h-[40px] px-4 text-[13px] rounded-md border border-border-strong bg-surface hover:bg-surface-muted disabled:opacity-50"
        >
          再解析
        </button>
        <button
          onClick={rewriteSheet}
          disabled={job.status !== "done"}
          className="h-[40px] px-4 text-[13px] rounded-md bg-primary text-white hover:bg-primary-dark disabled:opacity-50"
        >
          スプレッドシートへ書き込み
        </button>
        <button
          onClick={cancel}
          disabled={!canCancel || cancelling}
          className="h-[40px] px-4 text-[13px] rounded-md border border-danger/40 text-danger hover:bg-danger/5 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {isCancelling ? "中断処理中…" : "中断"}
        </button>
        {actionMsg && <span className="text-[13px] text-ink-muted">{actionMsg}</span>}
      </div>
    </div>
  );
}

function Stepper({
  currentStep,
  failed,
}: {
  currentStep: number;
  failed: boolean;
}) {
  return (
    <ol className="flex items-start">
      {STEPS.map((step, i) => {
        const isDone = !failed && i < currentStep;
        const isCurrent = !failed && i === currentStep;
        const markerClass = isDone
          ? "bg-success text-white border-success"
          : failed && i <= currentStep
          ? "bg-danger text-white border-danger"
          : isCurrent
          ? "bg-primary text-white border-primary"
          : "bg-surface text-ink-subtle border-border-strong";
        const labelClass = isDone || isCurrent || (failed && i <= currentStep)
          ? "text-ink"
          : "text-ink-subtle";
        const connectorClass = isDone
          ? "bg-success"
          : failed && i < currentStep
          ? "bg-danger"
          : "bg-border";
        return (
          <li key={step.key} className="flex-1 flex items-start">
            <div className="flex flex-col items-center flex-shrink-0 w-10">
              <div
                className={`relative w-7 h-7 rounded-full border flex items-center justify-center text-[12px] font-medium tabular ${markerClass}`}
              >
                {isDone ? (
                  <CheckIcon />
                ) : isCurrent && !failed ? (
                  <Spinner />
                ) : (
                  i + 1
                )}
              </div>
              <div className={`text-[11px] mt-1.5 text-center leading-tight ${labelClass}`}>
                {step.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-7 flex items-center">
                <div className={`h-[2px] w-full ${connectorClass}`} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StatusText({ status }: { status: string }) {
  const label: Record<string, string> = {
    queued: "待機中",
    downloading: "ダウンロード中",
    transcoding: "音声抽出中",
    analyzing: "AI解析中",
    writing_sheet: "シート書込中",
    done: "完了",
    failed: "失敗",
    cancelling: "中断処理中",
    cancelled: "中断済み",
  };
  const cls =
    status === "done"
      ? "text-success font-medium"
      : status === "failed"
      ? "text-danger font-medium"
      : status === "cancelled" || status === "cancelling"
      ? "text-warning font-medium"
      : "text-ink";
  return <span className={cls}>{label[status] ?? status}</span>;
}

function LogTimeline({
  logs,
  isRunning,
}: {
  logs: JobLog[];
  isRunning: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs.length]);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[18px] font-semibold">処理ログ</h2>
        <span className="text-[12px] text-ink-subtle">
          {logs.length > 0 && `${logs.length} 件`}
          {isRunning && logs.length > 0 && " (更新中…)"}
        </span>
      </div>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="max-h-[320px] overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-[13px] text-ink-subtle px-4 py-6">
              ログはまだありません。
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {logs.map((l) => (
                <li
                  key={l.id}
                  className="flex items-start gap-3 px-4 py-2.5 text-[13px]"
                >
                  <time className="text-[11px] text-ink-subtle tabular w-[62px] shrink-0 mt-0.5">
                    {new Date(l.created_at).toLocaleTimeString("ja-JP", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                  <span className={levelClass(l.level) + " w-[42px] shrink-0 text-[11px] font-medium uppercase mt-0.5"}>
                    {levelLabel(l.level)}
                  </span>
                  <span className="text-ink whitespace-pre-wrap break-words">
                    {l.message}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}

function levelLabel(level: "info" | "warn" | "error"): string {
  return level === "info" ? "INFO" : level === "warn" ? "WARN" : "ERR";
}

function levelClass(level: "info" | "warn" | "error"): string {
  return level === "info"
    ? "text-ink-subtle"
    : level === "warn"
    ? "text-warning"
    : "text-danger";
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4.5 10.5L8 14L15.5 6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function getElapsedSeconds(job: Job, now: number): number {
  const start = new Date(job.created_at).getTime();
  // 終了 (done/failed/cancelled) しているなら completed_at か updated_at で固定
  let end: number;
  if (job.completed_at) {
    end = new Date(job.completed_at).getTime();
  } else if (TERMINAL.has(job.status)) {
    end = new Date(job.updated_at).getTime();
  } else {
    end = now;
  }
  return Math.max(0, Math.floor((end - start) / 1000));
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-ink-muted mb-1">{label}</div>
      <div className="text-[14px]">{children}</div>
    </div>
  );
}
