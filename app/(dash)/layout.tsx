import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

const NAV = [
  { href: "/", label: "파이프라인" },
  { href: "/customers", label: "고객 목록" },
  { href: "/queue", label: "내 워크큐" },
  { href: "/monitor", label: "모니터" },
  { href: "/pay", label: "결제·정산" },
  { href: "/insights", label: "인사이트" },
  { href: "/import", label: "가져오기" },
  { href: "/duplicates", label: "중복 정리" },
  { href: "/settings", label: "설정" },
];

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

  return (
    <div className="flex min-h-screen">
      <aside className="w-52 shrink-0 border-r border-[#efe6ee] bg-white p-4 flex flex-col">
        <div className="mb-6">
          <div className="font-extrabold text-lg leading-tight">Glovek</div>
          <div className="text-xs text-muted">운영 어드민</div>
        </div>
        <nav className="space-y-1 flex-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block px-3 py-2 rounded-lg text-sm font-semibold text-ink hover:bg-[#fff0f6]"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 pt-4 border-t border-[#efe6ee]">
          <div className="text-xs text-muted truncate">{user.name}</div>
          <div className="text-[11px] text-muted mb-2">{user.role}</div>
          <form method="POST" action="/api/auth/logout">
            <button className="text-xs text-muted hover:text-pink" type="submit">
              로그아웃
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}
