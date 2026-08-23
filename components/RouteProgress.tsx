"use client";
// 전역 라우트 진행바 — 내부 링크 클릭 즉시 상단 바를 띄우고, 페이지 전환 완료 시 채우고 사라진다.
//   App Router 에는 라우터 이벤트가 없어, 앵커 클릭 감지 + pathname/searchParams 변화로 시작/종료를 판단.
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export default function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function start() {
    if (timer.current) return; // 이미 진행 중
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    setVisible(true);
    setWidth(8);
    timer.current = setInterval(() => {
      // 90%까지 점진 증가(완료는 전환 감지 시).
      setWidth((w) => (w < 90 ? w + Math.max(0.5, (90 - w) * 0.12) : w));
    }, 120);
  }
  function done() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setWidth(100);
    hideTimer.current = setTimeout(() => { setVisible(false); setWidth(0); }, 280);
  }

  // 내부 링크 클릭 → 시작(캡처 단계에서 앵커 탐색).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      let el = e.target as HTMLElement | null;
      while (el && el.tagName !== "A") el = el.parentElement;
      const a = el as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href");
      const target = a.getAttribute("target");
      if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:") || target === "_blank" || a.hasAttribute("download")) return;
      // 같은 URL 클릭은 무시.
      if (href === pathname) return;
      start();
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  // pathname·searchParams 변화 = 전환 완료.
  useEffect(() => {
    if (visible) done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  if (!visible) return null;
  return <div className="gk-topbar" aria-hidden><i style={{ width: `${width}%` }} /></div>;
}
