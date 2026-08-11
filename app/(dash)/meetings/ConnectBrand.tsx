"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { connectMeetingBrandAction } from "./actions";

// 매칭 필요 미팅 → 브랜드 수동 연결. '브랜드 매칭' 클릭 → 검색 → 연결.
export default function ConnectBrand({
  meetingId,
  brands,
}: {
  meetingId: string;
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return brands.slice(0, 50);
    return brands.filter((b) => b.name.toLowerCase().includes(s)).slice(0, 50);
  }, [q, brands]);

  function connect(brandId: string) {
    setErr("");
    start(async () => {
      const r = await connectMeetingBrandAction(meetingId, brandId);
      if (r.ok) { setOpen(false); router.refresh(); }
      else setErr(r.error ?? "연결 실패");
    });
  }

  if (!open) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {err && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--danger)" }}>{err}</span>}
        <button className="btn sm pri" onClick={() => setOpen(true)}>브랜드 매칭</button>
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", position: "relative" }}>
      {/* 바깥 클릭 시 닫힘 */}
      <div onClick={() => { setOpen(false); setQ(""); setErr(""); }} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="브랜드 검색…"
        disabled={pending}
        style={{ position: "relative", zIndex: 50, border: "1px solid var(--line)", borderRadius: 7, padding: "4px 8px", fontSize: 11.5, fontFamily: "inherit", width: 140 }}
      />
      <button className="btn sm" style={{ position: "relative", zIndex: 50 }} disabled={pending} onClick={() => { setOpen(false); setQ(""); setErr(""); }}>닫기</button>

      {/* 결과 목록 — 행 레이아웃을 밀지 않도록 절대 위치 팝오버 */}
      <div
        style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
          width: 240, maxHeight: 240, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8,
          background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.18)",
        }}
      >
        {err && <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: "var(--danger)" }}>{err}</div>}
        {filtered.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11.5, color: "var(--ink3)" }}>검색 결과 없음</div>
        ) : (
          filtered.map((b) => (
            <button
              key={b.id}
              disabled={pending}
              onClick={() => connect(b.id)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: 12,
                border: "none", borderBottom: "1px solid var(--line)", background: "none",
                cursor: "pointer", fontFamily: "inherit", color: "var(--ink)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {b.name || "(이름 없음)"}
            </button>
          ))
        )}
      </div>
    </span>
  );
}
