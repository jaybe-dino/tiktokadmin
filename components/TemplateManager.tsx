"use client";
// 발송 템플릿 관리 (기획 9절) — 설정에서 CRUD, {브랜드명}/{담당자명} 치환변수.
import { useState, useTransition } from "react";
import type { MsgTemplate } from "@/lib/templates";
import { upsertTemplateAction, deleteTemplateAction } from "@/app/(dash)/settings/template-actions";

const EMPTY = { key: "", label: "", channel: "email" as "email" | "sms", subject: "", body: "" };

export default function TemplateManager({ templates, canEdit }: { templates: MsgTemplate[]; canEdit: boolean }) {
  const [rows, setRows] = useState(templates);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const edit = (t: MsgTemplate) => setForm({ key: t.key, label: t.label, channel: t.channel, subject: t.subject, body: t.body });

  return (
    <div className="card">
      <div className="card-hd"><b>발송 템플릿</b><span style={{ color: "var(--ink3)", fontSize: 11 }}>{"{브랜드명} {담당자명}"} 치환 · 자동안내/리마인더/발송센터 공용</span></div>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr><th>key</th><th>이름</th><th>채널</th><th>내용</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>템플릿이 없습니다. 아래에서 추가하세요. (예: welcome_sms / welcome_email — 자동안내가 우선 사용)</td></tr>}
            {rows.map((t) => (
              <tr key={t.key}>
                <td><code style={{ fontSize: 11 }}>{t.key}</code></td>
                <td>{t.label || "—"}</td>
                <td><span className={`pill ${t.channel === "sms" ? "chip-amb" : "chip"}`}>{t.channel === "sms" ? "문자" : "메일"}</span></td>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink3)" }}>{t.subject ? `${t.subject} · ` : ""}{t.body}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {canEdit && <>
                    <button className="btn sm" onClick={() => edit(t)}>수정</button>{" "}
                    <button className="btn sm dgr" disabled={pending} onClick={() => start(async () => {
                      if (!confirm(`${t.key} 삭제?`)) return;
                      const r = await deleteTemplateAction(t.key);
                      if (r.ok) setRows((rs) => rs.filter((x) => x.key !== t.key));
                    })}>삭제</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 110px", gap: 8 }}>
            <input className="input" placeholder="key (예: welcome_sms)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            <input className="input" placeholder="이름 (예: 신규 안내 문자)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <select className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as "email" | "sms" })}>
              <option value="email">메일</option><option value="sms">문자</option>
            </select>
          </div>
          {form.channel === "email" && <input className="input" placeholder="제목 (메일)" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}
          <textarea className="input" rows={3} placeholder="본문 — {브랜드명}, {담당자명} 치환" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn pri" disabled={pending || !form.key || !form.body} onClick={() => start(async () => {
              setMsg("");
              const r = await upsertTemplateAction(form);
              if (r.ok) {
                setRows((rs) => {
                  const i = rs.findIndex((x) => x.key === form.key.trim());
                  const row = { id: "", updated_by: null, updated_at: new Date().toISOString(), ...form, key: form.key.trim() } as MsgTemplate;
                  return i >= 0 ? rs.map((x, j) => (j === i ? row : x)) : [...rs, row];
                });
                setForm(EMPTY); setMsg("✓ 저장됨");
              } else setMsg(r.error ?? "실패");
            })}>{pending ? "저장 중…" : "저장/수정"}</button>
            {msg && <span className="text-xs" style={{ color: msg.startsWith("✓") ? "var(--ok)" : "var(--danger)" }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
