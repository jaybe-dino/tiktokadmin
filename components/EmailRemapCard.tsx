"use client";
// 과거 메일함 재맵핑 카드 — 미매칭 메일 수 확인 + '맵핑하기' 클릭 시 현재 브랜드 기준 재연결.
import { useEffect, useState } from "react";
import { emailRemapStatsAction, emailRemapRunAction } from "@/app/(dash)/settings/email-remap-actions";

export default function EmailRemapCard() {
  const [unlinked, setUnlinked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function refresh() {
    const r = await emailRemapStatsAction();
    if (r.ok) setUnlinked(r.unlinked ?? 0);
  }
  useEffect(() => { refresh(); }, []);

  async function run() {
    if (busy) return;
    setBusy(true); setMsg("");
    const r = await emailRemapRunAction();
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "재맵핑 실패"); return; }
    const parts = Object.entries(r.via).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`);
    setMsg(`${r.scanned}건 검사 · ${r.linked}건 연결${parts.length ? ` (${parts.join(" · ")})` : ""} · 남은 미매칭 ${r.remaining}건`);
    setUnlinked(r.remaining);
  }

  return (
    <div className="card">
      <div className="card-hd">
        <b>메일함 ↔ 브랜드 재맵핑</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>수집 당시 미매칭된 과거 메일 재연결</span>
      </div>
      <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--ink2)", lineHeight: 1.6 }}>
        메일은 수집될 때 <b>별칭 → 브랜드 이메일 → 도메인</b> 순으로 자동 매칭됩니다.
        당시 브랜드 이메일이 없었거나 새 도메인이면 <b>미매칭(brand_id 없음)</b>으로 남습니다.
        지금 <b>맵핑하기</b>를 누르면 현재 등록된 브랜드 기준으로 다시 매칭해 연결합니다.
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="pill" style={{ background: unlinked ? "#fef3c7" : "#eafaf1", color: unlinked ? "#b45309" : "#0b7a52" }}>
            미매칭 메일 {unlinked == null ? "…" : `${unlinked.toLocaleString("ko-KR")}건`}
          </span>
          <button className="btn btn-primary" disabled={busy || unlinked === 0} onClick={run}>
            {busy ? "맵핑 중…" : "맵핑하기"}
          </button>
          <button className="btn sm" disabled={busy} onClick={refresh}>새로고침</button>
        </div>
        {msg && <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink2)" }}>{msg}</div>}
      </div>
    </div>
  );
}
