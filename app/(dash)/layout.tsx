import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import SideNav from "@/components/SideNav";
import BugReportButton from "@/components/BugReportButton";
import NotificationBell from "@/components/NotificationBell";
import { myNotifications } from "@/lib/notifications";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await currentUser();
  } catch (e) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-bold text-bad mb-2">레이아웃 오류 (진단)</h1>
        <pre className="text-xs bg-red-50 p-3 rounded overflow-auto whitespace-pre-wrap">{(e as Error).message}</pre>
      </div>
    );
  }
  if (!user) redirect("/login");

  const initial = (user.name ?? "?").slice(0, 2);
  const notif = await myNotifications(user.id).catch(() => ({ count: 0, items: [] }));

  return (
    <div className="flex min-h-screen">
      {/* 네이비 사이드바 (prototype v2.5) */}
      <aside className="w-[218px] shrink-0 flex flex-col sticky top-0 h-screen overflow-hidden"
        style={{ background: "var(--navy)", color: "#cbd5e1" }}>
        <div className="px-[18px] pt-[18px] pb-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <b className="text-white text-[16px] tracking-wide">GloveK <span style={{ color: "#60a5fa" }}>Admin</span></b>
          <span className="block text-[11px] mt-0.5" style={{ color: "#7c93b5" }}>운영 어드민 · 200브랜드 × 40명</span>
        </div>

        <SideNav />

        <div className="mt-auto px-3.5 py-3 flex gap-2.5 items-center" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-full text-white font-bold text-[12px] shrink-0"
            style={{ background: "linear-gradient(135deg,#60a5fa,#2563eb)" }}>{initial}</span>
          <div className="min-w-0">
            <b className="text-white text-[12px] block truncate">{user.name}</b>
            <small className="block text-[10.5px]" style={{ color: "#7c93b5" }}>{user.role}</small>
          </div>
          <form method="POST" action="/api/auth/logout" className="ml-auto">
            <button className="text-[11px]" style={{ color: "#7c93b5" }} type="submit" title="로그아웃">⏻</button>
          </form>
        </div>
      </aside>

      {/* 메인 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[52px] bg-white flex items-center gap-3 px-[18px] sticky top-0 z-40"
          style={{ borderBottom: "1px solid var(--line)" }}>
          {/* 정적 안내가 아니라 실제 고객목록 검색으로 연결(어포던스 일치) */}
          <Link href="/customers" className="flex-[0_1_420px] flex items-center gap-2 rounded-[9px] px-3 py-1.5"
            style={{ background: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink3)" }}>
            <span>🔍</span>
            <span className="text-[13px]">브랜드·담당자 검색 (고객 목록으로)</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell count={notif.count} items={notif.items} />
          </div>
        </header>
        <main className="flex-1 min-w-0 px-[22px] py-5 pb-16" style={{ maxWidth: 1440 }}>{children}</main>
      </div>
      {/* 우하단 플로팅 — 기능오류 제보 */}
      <BugReportButton />
    </div>
  );
}
