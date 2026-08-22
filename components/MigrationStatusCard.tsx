"use client";
// DB 마이그레이션 상태 카드 — 대표 전용. 미적용(pending) 목록 표시 + 인앱 적용.
import { useState, useTransition } from "react";
import type { MigrationState } from "@/lib/migrate";
import { getMigrationStateAction, applyMigrationsAction } from "@/app/(dash)/settings/migration-actions";

export default function MigrationStatusCard({ initial }: { initial: MigrationState | null }) {
  const [state, setState] = useState<MigrationState | null>(initial);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  function refresh() {
    setMsg("");
    start(async () => {
      const r = await getMigrationStateAction();
      if (r.ok) setState(r.data); else setMsg(r.error);
    });
  }
  function apply() {
    if (!confirm("미적용 마이그레이션을 지금 적용할까요? (DB 스키마 변경)")) return;
    setMsg("");
    start(async () => {
      const r = await applyMigrationsAction();
      if (!r.ok) { setMsg(r.error); return; }
      setMsg(r.data.applied.length ? `적용 완료: ${r.data.applied.join(", ")}` : "적용할 마이그레이션이 없습니다.");
      const s = await getMigrationStateAction();
      if (s.ok) setState(s.data);
    });
  }

  const drift = state?.drift ?? false;

  return (
    <div className="card">
      <div className="card-hd">
        <b>DB 마이그레이션</b>
        {state && (
          drift
            ? <span className="chip chip-red">미적용 {state.pending.length}건</span>
            : <span className="chip chip-grn">최신</span>
        )}
        <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: "auto" }}>대표 전용 · DDL</span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 10 }}>
        {!state && (
          <div className="note">상태를 불러오려면 새로고침을 누르세요.</div>
        )}
        {state && (
          <div style={{ fontSize: 13, color: "var(--ink2)" }}>
            총 {state.total}개 중 <b style={{ color: "var(--ink)" }}>{state.applied.length}개 적용</b>
            {drift && <> · <b style={{ color: "var(--red, #e03131)" }}>{state.pending.length}개 미적용</b></>}
          </div>
        )}
        {state && drift && (
          <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", background: "var(--bg2, #fafafa)", fontSize: 12 }}>
            <div style={{ color: "var(--ink3)", marginBottom: 4 }}>미적용 목록</div>
            <div style={{ display: "grid", gap: 2, fontFamily: "ui-monospace, monospace" }}>
              {state.pending.map((p) => <div key={p}>• {p}</div>)}
            </div>
          </div>
        )}
        {drift && (
          <div className="note" style={{ fontSize: 11 }}>
            미적용 마이그레이션이 있으면 새 기능에서 &ldquo;column ... does not exist&rdquo; 오류가 날 수 있습니다. &lsquo;지금 적용&rsquo;으로 반영하세요.
          </div>
        )}
        {msg && <div className="note" style={{ fontSize: 12 }}>{msg}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" disabled={pending} onClick={refresh}>{pending ? "확인 중…" : "상태 새로고침"}</button>
          {drift && <button className="btn btn-sm btn-primary" disabled={pending} onClick={apply}>지금 적용</button>}
        </div>
      </div>
    </div>
  );
}
