"use client";
import { useEffect, useState, type ReactNode } from "react";

// 프로토타입 v3.1 s-b360 상단 탭바(.tabs) 재현 — 패널은 서버에서 렌더된 노드를 받아
// display 토글로 전부 마운트 유지(내부 클라이언트 컴포넌트 상태 보존).
// 다른 컴포넌트(예: AI 브리프의 "심층 분석 →")가 window 커스텀 이벤트 'b360:tab' 으로 탭 전환 가능.
export type Brand360Tab = { key: string; label: string; node: ReactNode };

export default function Brand360Tabs({ tabs }: { tabs: Brand360Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  useEffect(() => {
    const onJump = (e: Event) => {
      const detail = (e as CustomEvent<string | { tab: string; anchor?: string }>).detail;
      const key = typeof detail === "string" ? detail : detail?.tab;
      const anchor = typeof detail === "string" ? undefined : detail?.anchor;
      if (key && tabs.some((t) => t.key === key)) {
        setActive(key);
        // 탭 전환 후 앵커 요소로 스크롤·강조(있으면).
        if (anchor) {
          setTimeout(() => {
            const el = document.getElementById(anchor);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.style.transition = "background-color .3s";
              const prev = el.style.backgroundColor;
              el.style.backgroundColor = "var(--tint,#fff3bf)";
              setTimeout(() => { el.style.backgroundColor = prev; }, 1400);
            }
          }, 60);
        }
      }
    };
    window.addEventListener("b360:tab", onJump);
    return () => window.removeEventListener("b360:tab", onJump);
    // tabs 는 서버 렌더 노드 배열 — key 목록은 렌더 간 동일.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <div className="tabs" style={{ marginBottom: 14 }}>
        {tabs.map((t) => (
          <button key={t.key} className={active === t.key ? "on" : ""} onClick={() => setActive(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} style={{ display: active === t.key ? "block" : "none" }}>
          {t.node}
        </div>
      ))}
    </div>
  );
}

/** 탭 전환 버튼 — v3.1 프로토타입의 "심층 분석 →" 등. */
export function TabJumpButton({ tab, className, style, children }: {
  tab: string; className?: string; style?: React.CSSProperties; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className ?? "btn sm"}
      style={style}
      onClick={() => window.dispatchEvent(new CustomEvent("b360:tab", { detail: tab }))}
    >
      {children}
    </button>
  );
}
