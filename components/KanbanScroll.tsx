"use client";
// 칸반 보드용 상단 가로 스크롤바 — 하단이 아닌 위쪽에서 좌우 스크롤(왔다갔다 편하게).
//   내부 .kb(실 스크롤러)와 상단 프록시 스크롤바를 양방향 동기화.
import { useEffect, useRef, useState } from "react";

export default function KanbanScroll({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [overflow, setOverflow] = useState(false);
  const kbRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const kb = wrapRef.current?.querySelector<HTMLElement>(".kb");
    if (!kb) return;
    kbRef.current = kb;
    const measure = () => {
      setWidth(kb.scrollWidth);
      setOverflow(kb.scrollWidth > kb.clientWidth + 4);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(kb);
    // 하단(실제) 스크롤 → 상단 프록시 동기화.
    const onKb = () => { if (topRef.current) topRef.current.scrollLeft = kb.scrollLeft; };
    kb.addEventListener("scroll", onKb, { passive: true });
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); kb.removeEventListener("scroll", onKb); window.removeEventListener("resize", measure); };
  }, [children]);

  // 상단 프록시 스크롤 → 하단(실제) 동기화.
  const onTop = () => { if (kbRef.current && topRef.current) kbRef.current.scrollLeft = topRef.current.scrollLeft; };

  return (
    <div>
      {overflow && (
        <div ref={topRef} onScroll={onTop} className="kb-topscroll" aria-hidden>
          <div style={{ width, height: 1 }} />
        </div>
      )}
      <div ref={wrapRef}>{children}</div>
    </div>
  );
}
