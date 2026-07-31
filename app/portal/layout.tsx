import "../globals.css";
import { portalSession } from "@/lib/portal-db";

export const dynamic = "force-dynamic";

// 포털 레이아웃 — 헤더만 담당(세션 게이트는 각 인증 페이지에서).
//   로그인 페이지는 세션 없이 렌더되어야 하므로 여기서 redirect 하지 않는다.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await portalSession().catch(() => null);
  return (
    <div style={{ minHeight: "100vh", background: "#faf7f8" }}>
      {session && (
        <header style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "12px 16px" }}>
          <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "#e84a80", fontWeight: 800 }}>GloveK</span>
            <nav style={{ display: "flex", gap: 12, fontSize: 14, marginLeft: "auto" }}>
              <a href="/portal" style={{ color: "#444" }}>홈</a>
              <a href="/portal/settlement" style={{ color: "#444" }}>정산</a>
              <a href="/portal/inquiry" style={{ color: "#444" }}>문의</a>
            </nav>
          </div>
        </header>
      )}
      <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>{children}</main>
    </div>
  );
}
