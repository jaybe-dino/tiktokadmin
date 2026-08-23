"use client";
// 파이프라인 화면 뷰 전환 — 파이프라인(칸반) ↔ 표. 선택은 localStorage 에 저장(화면별 key).
import { useEffect, useState } from "react";

export default function PipelineViewShell({ storageKey, board, table }: {
  storageKey: string; board: React.ReactNode; table: React.ReactNode;
}) {
  const [view, setView] = useState<"board" | "table">("board");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { const v = localStorage.getItem(storageKey); if (v === "table" || v === "board") setView(v); } catch { /* noop */ }
    setReady(true);
  }, [storageKey]);

  function pick(v: "board" | "table") {
    setView(v);
    try { localStorage.setItem(storageKey, v); } catch { /* noop */ }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          <button
            className="btn sm"
            onClick={() => pick("board")}
            style={{ borderRadius: 0, border: "none", background: view === "board" ? "var(--acc)" : "#fff", color: view === "board" ? "#fff" : "var(--ink2)", fontWeight: 700 }}
          >▦ 파이프라인</button>
          <button
            className="btn sm"
            onClick={() => pick("table")}
            style={{ borderRadius: 0, border: "none", borderLeft: "1px solid var(--line)", background: view === "table" ? "var(--acc)" : "#fff", color: view === "table" ? "#fff" : "var(--ink2)", fontWeight: 700 }}
          >▤ 표 (일괄편집)</button>
        </div>
      </div>
      {/* 두 뷰 모두 서버 렌더 후 전달받아 클라이언트에서 선택 표시 */}
      <div style={{ display: !ready || view === "board" ? "block" : "none" }}>{board}</div>
      <div style={{ display: ready && view === "table" ? "block" : "none" }}>{table}</div>
    </div>
  );
}
