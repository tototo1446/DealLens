import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  serverExternalPackages: ["fluent-ffmpeg", "ffmpeg-static"],
  // ffmpeg-static は require が string(binary path) を返すだけで、
  // Next.js の static analysis でバイナリ実体がトレースされない。
  // 明示的に deployment bundle へ同梱しないと Vercel 上で ENOENT になる。
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default config;
