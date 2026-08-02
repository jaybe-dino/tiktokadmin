"use client";

// 헤더 "+ 새 제안서" — 우측 견적 빌더로 스크롤·포커스(제안서 생성 진입점).
export default function NewProposalButton() {
  function open() {
    const el = document.getElementById("quote-builder");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const brand = el.querySelector("select");
    if (brand instanceof HTMLSelectElement) brand.focus();
  }
  return (
    <button className="btn pri" onClick={open}>
      + 새 제안서
    </button>
  );
}
