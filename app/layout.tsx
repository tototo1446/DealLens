import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "商談動画 解析ツール",
  description: "商談録画をAI解析してスプレッドシートに集約する内部ツール",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen font-sans">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto max-w-[1280px] px-8 py-4 flex items-center justify-between">
            <Link href="/" className="text-[15px] font-semibold text-ink">
              商談動画 解析ツール
            </Link>
            <nav className="flex items-center gap-6 text-[13px] text-ink-muted">
              <Link href="/" className="hover:text-ink">アップロード</Link>
              <Link href="/jobs" className="hover:text-ink">ジョブ一覧</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1280px] px-8 py-10">{children}</main>
      </body>
    </html>
  );
}
