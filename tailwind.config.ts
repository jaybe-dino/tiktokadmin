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
        // Glovek 브랜드 컬러
        pink: { DEFAULT: "#ff2d78", 600: "#c81e63" },
        orange: { DEFAULT: "#ff8a3d" },
        ink: "#1b1220",
        muted: "#6b6472",
        good: "#12a150",
        bad: "#e5484d",
        warn: "#e08a00",
      },
    },
  },
  plugins: [],
};

export default config;
