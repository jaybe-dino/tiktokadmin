"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item { href: string; label: string; ic: string }
interface Group { title: string; items: Item[] }

const GROUPS: Group[] = [
  { title: "대시보드", items: [
    { href: "/today", label: "오늘 (홈)", ic: "🏠" },
    { href: "/", label: "파이프라인 보드", ic: "📋" },
    { href: "/queue", label: "내 워크큐", ic: "⚡" },
    { href: "/monitor", label: "SLA 모니터", ic: "🛡️" },
  ]},
  { title: "고객", items: [
    { href: "/customers", label: "브랜드 (원장)", ic: "🏷️" },
    { href: "/import", label: "리드 가져오기", ic: "📥" },
    { href: "/duplicates", label: "중복 정리", ic: "🧹" },
  ]},
  { title: "영업", items: [
    { href: "/meetings", label: "미팅 캘린더", ic: "📅" },
    { href: "/proposals", label: "운영 견적", ic: "📄" },
    { href: "/proposal-docs", label: "운영 제안서", ic: "🎨" },
    { href: "/contracts", label: "계약·결제", ic: "✍️" },
  ]},
  { title: "마케팅", items: [
    { href: "/mkt", label: "마케팅 프로젝트", ic: "📣" },
    { href: "/send", label: "발송 센터", ic: "📤" },
  ]},
  { title: "커뮤니케이션", items: [
    { href: "/mail", label: "메일함", ic: "📬" },
    { href: "/drafts", label: "초안함", ic: "✉️" },
    { href: "/campaigns", label: "캠페인·윈백", ic: "📮" },
    { href: "/qna", label: "QnA 지식베이스", ic: "💬" },
  ]},
  { title: "온보딩·제품", items: [
    { href: "/onboarding", label: "온보딩 신청서", ic: "📝" },
    { href: "/docs", label: "서류·물류", ic: "📂" },
    { href: "/products", label: "제품·인증", ic: "📦" },
    { href: "/assets", label: "자산 저장소", ic: "🗄️" },
  ]},
  { title: "운영·정산", items: [
    { href: "/ops", label: "운영 사이클", ic: "🔁" },
    { href: "/cs", label: "CS 티켓", ic: "🎧" },
    { href: "/settlements", label: "정산", ic: "💰" },
    { href: "/pay", label: "결제 현황", ic: "💳" },
  ]},
  { title: "AI·관리", items: [
    { href: "/agents", label: "AI 에이전트", ic: "🤖" },
    { href: "/insights", label: "AI 인사이트", ic: "📈" },
    { href: "/approvals", label: "결재함", ic: "🗳️" },
    { href: "/slack", label: "Slack 알림", ic: "💬" },
    { href: "/channels", label: "유입 소스·자동발송", ic: "🔑" },
    { href: "/accounts", label: "계정·권한", ic: "👤" },
    { href: "/settings", label: "설정·조직", ic: "⚙️" },
    { href: "/guide", label: "사용 가이드", ic: "📖" },
  ]},
];

export default function SideNav() {
  const path = usePathname();
  const isOn = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="flex-1 overflow-y-auto py-1">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="px-3 pt-3 pb-0.5 text-[10.5px] font-bold tracking-widest" style={{ color: "#6b83a6" }}>
            {g.title}
          </div>
          {g.items.map((it) => {
            const on = isOn(it.href);
            return (
              <Link key={it.href} href={it.href}
                className="flex items-center gap-2.5 px-3.5 py-2 text-[13px]"
                style={{
                  color: on ? "#fff" : "#c3cfe0",
                  background: on ? "rgba(37,99,235,.22)" : "transparent",
                  borderLeft: `3px solid ${on ? "#60a5fa" : "transparent"}`,
                  fontWeight: on ? 600 : 400,
                }}>
                <span className="w-4 text-center text-[13px] opacity-90">{it.ic}</span>
                {it.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
