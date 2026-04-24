"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

type Mode = "upload" | "drive_url";

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [driveUrl, setDriveUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function handleSubmit() {
    setError("");
    setSubmitting(true);
    try {
      let payload: {
        source_type: "upload" | "drive_url";
        source_uri: string;
        original_filename?: string;
      };

      if (mode === "upload") {
        if (!file) throw new Error("ファイルを選択してください");
        setProgress("Vercel Blob にアップロード中…");
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
        });
        payload = {
          source_type: "upload",
          source_uri: blob.url,
          original_filename: file.name,
        };
      } else {
        if (!driveUrl.trim()) throw new Error("Drive URL を入力してください");
        payload = {
          source_type: "drive_url",
          source_uri: driveUrl.trim(),
        };
      }

      setProgress("ジョブを作成中…");
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
      router.push(`/jobs/${job_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold mb-2">商談動画を解析する</h1>
      <p className="text-ink-muted text-[14px] mb-8">
        ファイルをアップロードするか Google Drive の共有URL を貼ってください。解析が完了すると、業界別タブのスプレッドシートに結果が書き込まれます。
      </p>

      <div className="bg-surface border border-border rounded-lg p-6 space-y-6">
        <div className="flex gap-2">
          <ModeButton active={mode === "upload"} onClick={() => setMode("upload")}>
            ファイル直接アップロード
          </ModeButton>
          <ModeButton active={mode === "drive_url"} onClick={() => setMode("drive_url")}>
            Google Drive URL
          </ModeButton>
        </div>

        {mode === "upload" ? (
          <div>
            <label className="block text-[13px] font-medium mb-2">動画ファイル（mp4 / mov / m4a / mp3 / webm）</label>
            <input
              type="file"
              accept="video/*,audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[14px] file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-white file:cursor-pointer"
            />
            {file && (
              <p className="text-[12px] text-ink-subtle mt-2">
                {file.name} ({Math.round(file.size / 1024 / 1024)} MB)
              </p>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-[13px] font-medium mb-2">Google Drive 共有URL</label>
            <input
              type="url"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/xxxxx/view?usp=sharing"
              className="w-full h-[44px] px-3 border border-border-strong rounded-md text-[14px] focus:outline-none focus:border-primary"
            />
            <p className="text-[12px] text-ink-subtle mt-2">
              「リンクを知っている全員」に共有設定したファイルが対象。サービスアカウントへの共有が必要なケースもあり。
            </p>
          </div>
        )}

        <div className="pt-2 border-t border-border">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="h-[44px] px-6 rounded-md bg-primary text-white text-[14px] font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? progress || "処理中…" : "解析を開始"}
          </button>
          {error && <p className="text-[13px] text-danger mt-3">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-[36px] px-4 text-[13px] rounded-md border ${
        active
          ? "bg-primary text-white border-primary"
          : "bg-surface text-ink border-border-strong hover:bg-surface-muted"
      }`}
    >
      {children}
    </button>
  );
}
