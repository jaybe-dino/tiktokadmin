"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveQuestionAction, deleteQuestionAction } from "./actions";

type QType = "select" | "multi" | "text" | "short" | "consent";
interface Row {
  id?: string; kind: string; section?: string; key: string; label: string;
  type: QType; options?: string[]; placeholder?: string; sort_order: number; active: boolean;
}
const TYPES: [QType, string][] = [["text", "긴 답(textarea)"], ["short", "짧은 답"], ["select", "단일 선택"], ["multi", "복수 선택"], ["consent", "동의 체크"]];

export default function SurveyQuestionsEditor({ kind, kindLabel, initial }: { kind: string; kindLabel: string; initial: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>(initial);
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2600); };

  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function save(i: number) {
    const r = rows[i];
    if (!r.key.trim() || !r.label.trim()) { flash("키·라벨을 입력하세요."); return; }
    start(async () => {
      const res = await saveQuestionAction({
        id: r.id, kind, section: r.section, qkey: r.key, label: r.label, type: r.type,
        options: r.options, placeholder: r.placeholder, sort_order: r.sort_order, active: r.active,
      });
      if (res.ok) { flash("저장됨"); router.refresh(); } else flash(res.error ?? "저장 실패");
    });
  }
  function remove(i: number) {
    const r = rows[i];
    if (!r.id) { setRows((rs) => rs.filter((_, j) => j !== i)); return; }
    if (!confirm("이 문항을 삭제할까요?")) return;
    start(async () => { await deleteQuestionAction(r.id!); flash("삭제됨"); router.refresh(); });
  }
  function add() {
    const maxOrd = rows.reduce((m, r) => Math.max(m, r.sort_order), 0);
    setRows((rs) => [...rs, { kind, key: "", label: "", type: "text", options: [], section: "", sort_order: maxOrd + 10, active: true }]);
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <b>{kindLabel}</b>
        <span className="chip" style={{ fontSize: 10 }}>{rows.length}문항</span>
        <button className="btn sm pri" style={{ marginLeft: "auto" }} onClick={add}>+ 문항 추가</button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, background: r.active ? "#fff" : "#fafafa", opacity: r.active ? 1 : 0.7 }}>
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 140px", gap: 6, alignItems: "center" }}>
              <input className="f" value={r.section ?? ""} onChange={(e) => upd(i, { section: e.target.value })} placeholder="구획" title="주제 구획(예: 제품·브랜드)" />
              <input className="f" value={r.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="문항 라벨" />
              <select className="f" value={r.type} onChange={(e) => upd(i, { type: e.target.value as QType })}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 70px", gap: 6, alignItems: "center", marginTop: 6 }}>
              <input className="f" value={r.key} onChange={(e) => upd(i, { key: e.target.value })} placeholder="키(qkey)" title="응답 저장 키 — 한 번 정하면 유지 권장" style={{ fontFamily: "monospace", fontSize: 12 }} />
              {(r.type === "select" || r.type === "multi") ? (
                <input className="f" value={(r.options ?? []).join(", ")} onChange={(e) => upd(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="선택지(쉼표로 구분)" />
              ) : (
                <input className="f" value={r.placeholder ?? ""} onChange={(e) => upd(i, { placeholder: e.target.value })} placeholder="플레이스홀더(선택)" />
              )}
              <input className="f" type="number" value={r.sort_order} onChange={(e) => upd(i, { sort_order: Number(e.target.value) || 0 })} title="정렬 순서" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink2)" }}>
                <input type="checkbox" checked={r.active} onChange={(e) => upd(i, { active: e.target.checked })} /> 활성(발송에 노출)
              </label>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button className="btn sm" disabled={pending} onClick={() => remove(i)} style={{ color: "#e03131" }}>삭제</button>
                <button className="btn sm pri" disabled={pending} onClick={() => save(i)}>저장</button>
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="note">문항이 없습니다. 「+ 문항 추가」로 시작하세요.</div>}
      </div>
      {msg && <div className="note" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
