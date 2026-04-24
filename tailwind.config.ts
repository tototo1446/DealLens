import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#1F3A5F", dark: "#162B47" },
        accent: "#B6873D",
        danger: "#C74646",
        warning: "#B7791F",
        success: "#2F855A",
        ink: { DEFAULT: "#111318", muted: "#5B6270", subtle: "#7C8595" },
        border: { DEFAULT: "#E6E9EF", strong: "#CDD3DD" },
        surface: { DEFAULT: "#FFFFFF", muted: "#F1F3F6" },
        background: "#F7F8FA",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Hiragino Sans",
          "Noto Sans JP",
          "Yu Gothic",
          "sans-serif",
        ],
        mono: ["SFMono-Regular", "JetBrains Mono", "Menlo", "monospace"],
      },
      borderRadius: { md: "10px", lg: "14px" },
    },
  },
  plugins: [],
};

export default config;
