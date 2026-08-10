"use client";
// 타임라인 키워드 클릭 → 해당 커뮤 내용(미팅·메일 등) 탭으로 이동(+앵커 스크롤).
import type { ReactNode } from "react";

export default function TimelineJump({ tab, anchor, children }: { tab: string; anchor?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("b360:tab", { detail: { tab, anchor } }))}
      title="해당 커뮤 내용으로 이동"
      style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", fontSize: 12.5, color: "var(--acc)", textAlign: "left", cursor: "pointer", textDecoration: "underline dotted" }}
    >
      {children}
    </button>
  );
}
