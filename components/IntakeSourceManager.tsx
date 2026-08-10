"use client";
// 유입 소스 라벨 관리(CRUD) — 자동발송 허용 유입소스 목록을 어드민에서 추가/수정/삭제.
//   여기서 만든 소스가 채널 등록 드롭다운·전역 자동안내 대상 칩에 모두 노출된다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIntakeSourceAction, updateIntakeSourceAction, deleteIntakeSourceAction } from "@/app/actions";
import type { IntakeSource } from "@/lib/intake-sources";

export default function IntakeSourceManager({ sources, canEdit }: { sources: IntakeSource[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openAdd, setOpenAdd] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [msg, setMsg] = useState("");

  const active = sources.filter((s) => s.enabled).length;

  const add = () => start(async () => {
    setMsg("");
    const r = await createIntakeSourceAction({ key, label });
    if (r.ok) { setKey(""); setLabel(""); setOpenAdd(false); router.refresh(); }
    else setMsg(r.error ?? "실패");
  });
  const toggle = (s: IntakeSource) => start(async () => { await updateIntakeSourceAction(s.key, { enabled: !s.enabled }); router.refresh(); });
  const saveLabel = (s: IntakeSource) => start(async () => { await updateIntakeSourceAction(s.key, { label: editLabel }); setEditKey(null); router.refresh(); });
  const del = (s: IntakeSource) => start(async () => {
    const note = s.key === "etc" ? "'기타'는 시스템 폴백값이라 비활성만 됩니다. 진행할까요?" : `'${s.label}' 소스 삭제?`;
    if (confirm(note)) { await deleteIntakeSourceAction(s.key); router.refresh(); }
  });

  return (
    <div className="card">
      <div className="card-hd">
        <b>유입 소스 목록 관리</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>전체 {sources.length} · 활성 {active}</span>
        {canEdit && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenAdd((v) => !v)}>{openAdd ? "닫기" : "+ 소스 추가"}</button>}
      </div>

      {openAdd && canEdit && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label className="label">키(영문소문자·숫자·_)</label><input className="input" style={{ width: 180 }} placeholder="예: kakao_ad" value={key} onChange={(e) => setKey(e.target.value)} /></div>
          <div><label className="label">표시명</label><input className="input" style={{ width: 200 }} placeholder="예: 카카오 광고" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={pending || !key.trim() || !label.trim()} onClick={add}>{pending ? "생성 중…" : "추가"}</button>
        </div>
      )}

      <div style={{ padding: "6px 0" }}>
        {sources.map((s) => (
          <div key={s.key} style={{ padding: "8px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: s.enabled ? 1 : 0.5 }}>
            {editKey === s.key ? (
              <>
                <input className="input" style={{ width: 200 }} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => saveLabel(s)}>저장</button>
                <button className="btn btn-sm" onClick={() => setEditKey(null)}>취소</button>
              </>
            ) : (
              <>
                <b>{s.label}</b>
                <code style={{ fontSize: 11, color: "var(--ink3)" }}>{s.key}</code>
                {s.builtin && <span className="pill" style={{ fontSize: 10 }}>기본</span>}
                {!s.enabled && <span className="pill" style={{ fontSize: 10, background: "#fee2e2", color: "#b91c1c" }}>비활성</span>}
                {canEdit && (
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                      <span className={`tgl ${s.enabled ? "on" : ""}`} onClick={() => toggle(s)} /> 노출
                    </label>
                    <button className="btn btn-sm" onClick={() => { setEditKey(s.key); setEditLabel(s.label); }}>✏️</button>
                    <button className="btn btn-sm" disabled={pending} onClick={() => del(s)}>삭제</button>
                  </span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="note" style={{ margin: "8px 16px 14px" }}>
        여기서 추가한 소스는 <b>채널 등록 드롭다운</b>과 <b>설정 → 신규 리드 자동 안내</b> 대상 칩에 모두 나타납니다.
        <b>비활성</b>으로 두면 목록에서 숨겨지지만 기존 채널·이력은 유지됩니다.
      </div>
      {msg && <div className="note" style={{ margin: "0 16px 10px", color: "var(--bad)" }}>{msg}</div>}
    </div>
  );
}
