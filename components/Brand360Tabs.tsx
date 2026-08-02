"use client";
import { useState, type ReactNode } from "react";

// 프로토타입 s-b360 상단 탭바(.tabs) 재현 — 패널은 서버에서 렌더된 노드를 받아
// display 토글로 전부 마운트 유지(내부 클라이언트 컴포넌트 상태 보존).
export type Brand360Tab = { key: string; label: string; node: ReactNode };

export default function Brand360Tabs({ tabs }: { tabs: Brand360Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
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
