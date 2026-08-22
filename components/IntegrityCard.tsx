"use client";
// 데이터 정합성 점검 카드 — 파트장·대표. 버튼으로 읽기전용 스캔 실행.
import { useState, useTransition } from "react";
import type { IntegrityResult } from "@/lib/integrity";
import { runIntegrityAction } from "@/app/(dash)/settings/integrity-actions";

export default function IntegrityCard() {
  const [res, setRes] = useState<IntegrityResult | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  function run() {
    setMsg("");
    start(async () => {
      const r = await runIntegrityAction();
      if (r.ok) setRes(r.data); else setMsg(r.error);
    });
  }

  return (
    <div className="card">
      <div className="card-hd">
        <b>데이터 정합성 점검</b>
        {res && (res.healthy
          ? <span className="chip chip-grn">이상 없음</span>
          : <span className="chip chip-red">{res.issues}건 발견</span>)}
        <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: "auto" }}>읽기 전용</span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 10 }}>
        {!res && <div className="note">고아 레코드·끊긴 링크·드랍 브랜드 잔여 알림 등을 스캔합니다.</div>}
        {res && (
          <div style={{ display: "grid", gap: 4 }}>
            {res.checks.map((c) => (
              <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1, color: "var(--ink2)" }}>{c.label}</span>
                {c.count == null
                  ? <span className="chip" title={c.note}>점검불가</span>
                  : c.count > 0
                    ? <span className="chip chip-red">{c.count}</span>
                    : <span className="chip chip-grn">0</span>}
              </div>
            ))}
          </div>
        )}
        {msg && <div className="note" style={{ fontSize: 12 }}>{msg}</div>}
        <div>
          <button className="btn btn-sm btn-primary" disabled={pending} onClick={run}>{pending ? "점검 중…" : "정합성 점검 실행"}</button>
        </div>
      </div>
    </div>
  );
}
