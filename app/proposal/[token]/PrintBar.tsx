"use client";
// 제안서 상단 인쇄/PDF 저장 바 — 인쇄 시 자동 숨김(@media print).
export default function PrintBar({ accent }: { accent: string }) {
  return (
    <div className="pp-printbar no-print">
      <button onClick={() => window.print()} style={{ background: accent }}>🖨️ 인쇄 / PDF 저장</button>
    </div>
  );
}
