"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

type Phase = "idle" | "uploading" | "creating" | "redirecting";

export default function HomePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [percentage, setPercentage] = useState(0);
  const [error, setError] = useState<string>("");

  const submitting = phase !== "idle";

  async function handleSubmit() {
    setError("");
    try {
      if (!file) throw new Error("ファイルを選択してください");
      setPhase("uploading");
      setUploadedBytes(0);
      setTotalBytes(file.size);
      setPercentage(0);
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        multipart: true,
        onUploadProgress: ({ loaded, total, percentage }) => {
          setUploadedBytes(loaded);
          setTotalBytes(total);
          setPercentage(percentage);
        },
      });
      const payload = {
        source_type: "upload" as const,
        source_uri: blob.url,
        original_filename: file.name,
      };

      setPhase("creating");
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `ingest失敗: ${res.status}`);
      }
      const { job_id } = (await res.json()) as { job_id: string };
      setPhase("redirecting");
      router.push(`/jobs/${job_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold mb-2">商談動画を解析する</h1>
      <p className="text-ink-muted text-[14px] mb-8">
        動画ファイルをアップロードしてください。解析が完了すると、業界別タブのスプレッドシートに結果が書き込まれます。
      </p>

      <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
        <div>
          <label className="block text-[13px] font-medium mb-2">動画ファイル(mp4 / mov / m4a / mp3 / webm)</label>
          <input
            type="file"
            accept="video/*,audio/*"
            disabled={submitting}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[14px] file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-white file:cursor-pointer disabled:opacity-50"
          />
          {file && (
            <p className="text-[12px] text-ink-subtle mt-2 tabular">
              {file.name} ({formatMB(file.size)})
            </p>
          )}
        </div>

        {phase === "uploading" && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between text-[12px] tabular">
              <span className="text-ink-muted">アップロード中</span>
              <span className="text-ink">
                {formatMB(uploadedBytes)} / {formatMB(totalBytes)}
                <span className="ml-2 font-medium">{percentage.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-1.5 w-full bg-surface-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${Math.min(100, percentage)}%` }}
              />
            </div>
          </div>
        )}

        {(phase === "creating" || phase === "redirecting") && (
          <p className="text-[13px] text-ink-muted">
            {phase === "creating" ? "ジョブを作成中…" : "ジョブ画面へ移動中…"}
          </p>
        )}

        <div className="pt-2 border-t border-border">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="h-[44px] px-6 rounded-md bg-primary text-white text-[14px] font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "処理中…" : "解析を開始"}
          </button>
          {error && <p className="text-[13px] text-danger mt-3">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
