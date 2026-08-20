"use client";
// 마케팅 제안서 상단 PDF 저장 바 — 인쇄(=A4 가로 PDF) 트리거. 인쇄 시 자동 숨김.
export default function MktPrintBar({ title }: { title: string }) {
  return (
    <div className="mp-noprint" style={{ position: "sticky", top: 0, zIndex: 20, background: "#0b1220", color: "#fff",
      display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
      <b style={{ fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</b>
      <span style={{ fontSize: 11, color: "#94a3b8" }}>인쇄 대화상자에서 &lsquo;대상: PDF로 저장&rsquo; · 용지 A4 · 가로</span>
      <button onClick={() => window.print()} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>⬇️ PDF로 저장 (A4 가로)</button>
    </div>
  );
}
