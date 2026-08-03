"use client";

// v3.1 프로토타입의 탭 점프 버튼(예: AI 브리프의 "심층 분석 →").
// 프로토타입과 동일하게 탭바 버튼을 라벨로 찾아 클릭 — Brand360Tabs 내부 상태를 건드리지 않는다.
import type { CSSProperties, ReactNode } from "react";

export default function TabJumpButton({ label, className, style, children }: {
  label: string; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className ?? "btn sm"}
      style={style}
      onClick={() => {
        const btns = Array.from(document.querySelectorAll<HTMLButtonElement>(".tabs button"));
        btns.find((b) => (b.textContent ?? "").trim() === label)?.click();
      }}
    >
      {children}
    </button>
  );
}
