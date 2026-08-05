import "../globals.css";

export const dynamic = "force-dynamic";

// 고객 온보딩 포털 레이아웃 — 세션 게이트는 각 페이지에서.
export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0f1115" }}>
      <main style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px" }}>{children}</main>
    </div>
  );
}
