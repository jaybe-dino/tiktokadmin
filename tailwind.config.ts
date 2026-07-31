import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // GloveK Admin 디자인 시스템 (prototype v2.5)
        navy: { DEFAULT: "#0f2440", 2: "#1e3a5f" },
        // 전면 리스킨: 기존 컴포넌트의 pink 를 액센트 블루로 리맵
        pink: { DEFAULT: "#2563eb", 600: "#1d4ed8" },
        acc: { DEFAULT: "#2563eb", 600: "#1d4ed8" },
        orange: { DEFAULT: "#d97706" },
        line: "#e5e9f0",
        ink: "#111827",
        muted: "#8b93a1",
        good: "#16a34a",
        bad: "#dc2626",
        warn: "#d97706",
        // 파트 컬러
        mkt: "#d97706", sales: "#2563eb", onb: "#16a34a", ops: "#9333ea", settle: "#0d9488",
      },
      boxShadow: {
        card: "0 1px 3px rgba(15,36,64,.07), 0 1px 2px rgba(15,36,64,.05)",
      },
    },
  },
  plugins: [],
};

export default config;
