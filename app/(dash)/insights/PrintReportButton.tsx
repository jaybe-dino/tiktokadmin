"use client";

/** 대표 리포트 보기 — 현재 인사이트 리포트를 인쇄/PDF 저장 대화상자로 연다. */
export default function PrintReportButton() {
  return (
    <button className="btn" onClick={() => window.print()}>
      대표 리포트 보기
    </button>
  );
}
