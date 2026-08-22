"use client";
// 재사용 복사 버튼 — 클릭 시 클립보드 복사 + "복사됨" 잠깐 표시.
import { useState } from "react";

export default function CopyButton({ text, label = "복사", title, small = true, className }: {
  text: string; label?: string; title?: string; small?: boolean; className?: string;
}) {
  const [done, setDone] = useState(false);
  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 API 불가(비보안 컨텍스트 등) — 폴백.
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  }
  return (
    <button
      type="button"
      className={className ?? `btn ${small ? "sm" : ""}`}
      onClick={copy}
      title={title ?? `복사: ${text}`}
      style={{ whiteSpace: "nowrap" }}
    >
      {done ? "✓ 복사됨" : `📋 ${label}`}
    </button>
  );
}
