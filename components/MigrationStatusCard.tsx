"use client";
// DB 마이그레이션 상태 카드 — 대표 전용. 미적용(pending) 목록 표시 + 인앱 적용.
import { useState, useTransition } from "react";
import type { MigrationState } from "@/lib/migrate";
import { getMigrationStateAction, applyMigrationsAction, applySelectedMigrationsAction } from "@/app/(dash)/settings/migration-actions";

export default function MigrationStatusCard({ initial }: { initial: MigrationState | null }) {
  const [state, setState] = useState<MigrationState | null>(initial);
  // 결과는 화면에 남긴다(자동으로 사라지지 않게) — 성공·실패를 놓치지 않도록.
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"ok" | "err" | "info">("info");
  // 고른 것만 적용 — 필요한 변경만 올리고 관계없는 변경은 건드리지 않는다.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // 적용 전 확인은 브라우저 기본 대화상자 대신 카드 안 패널로 받는다.
  //   (native confirm 은 화면 밖 요소라 자동화·스크린리더가 다루기 어렵고, 열린 동안 탭이 멈춘다)
  const [confirming, setConfirming] = useState<"selected" | "all" | null>(null);
  const [running, setRunning] = useState(false);   // 중복 클릭 방지(요청 진행 중)
  const [pending, start] = useTransition();
  const busy = pending || running;

  const say = (m: string, tone: "ok" | "err" | "info" = "info") => { setMsg(m); setMsgTone(tone); };

  function refresh() {
    if (busy) return;
    say("");
    start(async () => {
      const r = await getMigrationStateAction();
      if (r.ok) { setState(r.data); say(`상태 갱신됨 — 총 ${r.data.total}개 중 ${r.data.applied.length}개 적용`, "info"); }
      else say(r.error, "err");
    });
  }

  /** 확인 패널에서 「적용」을 눌렀을 때만 실제로 실행된다. */
  function runApply(mode: "selected" | "all") {
    if (busy) return;                 // 중복 클릭 방지
    const list = [...picked];
    if (mode === "selected" && list.length === 0) { say("적용할 파일을 선택하세요.", "err"); return; }
    setRunning(true);
    setConfirming(null);
    say("적용 중…", "info");
    start(async () => {
      try {
        const r = mode === "selected"
          ? await applySelectedMigrationsAction(list)
          : await applyMigrationsAction();
        if (!r.ok) { say(`적용 실패 — ${r.error}`, "err"); return; }
        say(r.data.applied.length
          ? `적용 완료 (${r.data.applied.length}건): ${r.data.applied.join(", ")}`
          : "적용된 파일이 없습니다 — 이미 적용돼 있거나 선택이 비어 있습니다.", r.data.applied.length ? "ok" : "info");
        if (mode === "selected") setPicked(new Set());
        const s2 = await getMigrationStateAction();
        if (s2.ok) setState(s2.data);
      } catch (e) {
        say(`적용 실패 — ${(e as Error).message}`, "err");
      } finally {
        setRunning(false);
      }
    });
  }

  const toggle = (f: string) => {
    if (busy) return;
    setConfirming(null);   // 선택이 바뀌면 확인 단계를 되돌린다
    setPicked((p) => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  };

  const drift = state?.drift ?? false;
  const pickedList = [...picked];

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
                  <input type="checkbox" data-testid={`migrate-pick-${p}`} checked={picked.has(p)} disabled={busy} onChange={() => toggle(p)} />
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
            누르면 아래에 확인 패널이 열리고, 거기서 <b>「예, 지금 적용합니다」</b>를 눌러야 실행됩니다.
          </div>
        )}
        {/* 적용 전 확인 — 브라우저 기본 대화상자 대신 이 패널에서 받는다.
            무엇을 적용하는지 파일명을 그대로 보여주고, 여기 「적용」을 눌러야 실행된다. */}
        {confirming && (
          <div data-testid="migrate-confirm-panel"
            style={{ border: "1px solid #f0c36d", background: "#fffaf0", borderRadius: 8, padding: "10px 12px", fontSize: 12.5 }}>
            <b style={{ color: "#a06000" }}>
              {confirming === "selected"
                ? `아래 ${pickedList.length}개 파일만 적용합니다 — DB 스키마가 바뀝니다.`
                : `미적용 ${state?.pending.length ?? 0}개를 모두 적용합니다 — DB 스키마가 바뀝니다.`}
            </b>
            <div style={{ margin: "6px 0", fontFamily: "ui-monospace, monospace", display: "grid", gap: 2 }}>
              {(confirming === "selected" ? pickedList : state?.pending ?? []).map((f) => <div key={f}>• {f}</div>)}
            </div>
            <div style={{ color: "#8a6d3b", marginBottom: 8 }}>
              각 파일은 따로 적용되며, 하나가 실패해도 앞서 적용된 것은 그대로 남습니다.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm btn-primary" data-testid="migrate-confirm-apply"
                disabled={busy} onClick={() => runApply(confirming)}>
                {busy ? "적용 중…" : "예, 지금 적용합니다"}
              </button>
              <button className="btn btn-sm" data-testid="migrate-confirm-cancel"
                disabled={busy} onClick={() => { setConfirming(null); say("적용을 취소했습니다.", "info"); }}>
                취소
              </button>
            </div>
          </div>
        )}

        {/* 결과 — 성공·실패 모두 화면에 남는다(대화상자 아님). */}
        {msg && (
          <div data-testid="migrate-result" role="status" className="note"
            style={{ fontSize: 12, whiteSpace: "pre-wrap",
                     borderColor: msgTone === "err" ? "#f3b8b8" : msgTone === "ok" ? "#b7e3c8" : undefined,
                     background: msgTone === "err" ? "#fff5f5" : msgTone === "ok" ? "#f2fbf5" : undefined,
                     color: msgTone === "err" ? "#c92a2a" : msgTone === "ok" ? "#0b7a52" : undefined }}>
            {msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" data-testid="migrate-refresh" disabled={busy} onClick={refresh}>
            {busy ? "처리 중…" : "상태 새로고침"}
          </button>
          {drift && (
            <button className="btn btn-sm btn-primary" data-testid="migrate-apply-selected"
              disabled={busy || picked.size === 0 || confirming === "selected"}
              onClick={() => { setConfirming("selected"); say(""); }}>
              선택 적용{picked.size > 0 ? ` (${picked.size})` : ""}
            </button>
          )}
          {drift && (
            <button className="btn btn-sm" data-testid="migrate-apply-all"
              disabled={busy || confirming === "all"}
              onClick={() => { setConfirming("all"); say(""); }}>
              지금 적용(전체)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
