"use client";
// DB 마이그레이션 상태 카드 — 대표 전용. 미적용(pending) 목록 표시 + 인앱 적용.
import { useState, useTransition } from "react";
import type { MigrationState } from "@/lib/migrate";
import { getMigrationStateAction, applyMigrationsAction, applySelectedMigrationsAction } from "@/app/(dash)/settings/migration-actions";

export default function MigrationStatusCard({ initial }: { initial: MigrationState | null }) {
  const [state, setState] = useState<MigrationState | null>(initial);
  const [msg, setMsg] = useState("");
  // 고른 것만 적용 — 필요한 변경만 올리고 관계없는 변경은 건드리지 않는다.
  const [picked, setPicked] = useState<Set<string>>(new Set());
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

  function applySelected() {
    const list = [...picked];
    if (list.length === 0) { setMsg("적용할 파일을 선택하세요."); return; }
    if (!confirm(`선택한 ${list.length}개만 적용할까요? (DB 스키마 변경)\n\n${list.join("\n")}`)) return;
    setMsg("");
    start(async () => {
      const r = await applySelectedMigrationsAction(list);
      if (!r.ok) { setMsg(`적용 실패 — ${r.error}`); return; }
      setMsg(r.data.applied.length ? `적용 완료: ${r.data.applied.join(", ")}` : "적용된 파일이 없습니다.");
      setPicked(new Set());
      const s2 = await getMigrationStateAction();
      if (s2.ok) setState(s2.data);
    });
  }
  const toggle = (f: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n; });

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
            <div style={{ color: "var(--ink3)", marginBottom: 4 }}>미적용 목록 — 체크한 것만 적용할 수 있습니다</div>
            <div style={{ display: "grid", gap: 3, fontFamily: "ui-monospace, monospace" }}>
              {state.pending.map((p) => (
                <label key={p} style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={picked.has(p)} onChange={() => toggle(p)} />
                  <span>{p}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {drift && (
          <div className="note" style={{ fontSize: 11 }}>
            미적용 마이그레이션이 있으면 새 기능에서 &ldquo;relation/column ... does not exist&rdquo; 오류가 납니다.
            필요한 파일만 체크해 <b>선택 적용</b>하거나, 전부 올리려면 <b>지금 적용(전체)</b>을 누르세요.
            각 파일은 따로 적용되며 하나가 실패해도 앞서 적용된 것은 그대로 남습니다.
          </div>
        )}
        {msg && <div className="note" style={{ fontSize: 12 }}>{msg}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" disabled={pending} onClick={refresh}>{pending ? "확인 중…" : "상태 새로고침"}</button>
          {drift && <button className="btn btn-sm btn-primary" disabled={pending || picked.size === 0} onClick={applySelected}>
            선택 적용{picked.size > 0 ? ` (${picked.size})` : ""}
          </button>}
          {drift && <button className="btn btn-sm" disabled={pending} onClick={apply}>지금 적용(전체)</button>}
        </div>
      </div>
    </div>
  );
}
