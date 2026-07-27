import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glovek 운영 어드민",
  description: "공유 Postgres 원장 · 게이트/SLA · Slack 양방향 운영",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
