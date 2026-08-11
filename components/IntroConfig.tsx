"use client";
// 설정 — 소개자료 발송 문구(문자·이메일) 관리. 브랜드360 '소개자료 보내기'에서 이 내용으로 발송.
import { useState, useTransition } from "react";
import type { IntroConfig } from "@/lib/intro";
import { saveIntroConfigAction } from "@/app/actions";

export default function IntroConfigCard({ config, canEdit }: { config: IntroConfig; canEdit: boolean }) {
  const [c, setC] = useState(config);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const set = <K extends keyof IntroConfig>(k: K, v: IntroConfig[K]) => setC((p) => ({ ...p, [k]: v }));

  const save = () => start(async () => {
    setMsg("");
    const r = await saveIntroConfigAction(c);
    setMsg(r.ok ? "저장됨 ✓" : r.error ?? "실패");
  });

  return (
    <div className="card">
      <div className="card-hd">
        <b>소개자료 발송 문구</b>
        <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: "auto" }}>브랜드360 「소개자료 보내기」에서 이 내용으로 발송</span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${c.send_sms ? "on" : ""}`} onClick={() => canEdit && set("send_sms", !c.send_sms)} /> 문자(SMS) 기본 선택
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${c.send_email ? "on" : ""}`} onClick={() => canEdit && set("send_email", !c.send_email)} /> 이메일 기본 선택
          </label>
        </div>

        <div>
          <label className="label">문자 내용 ({"{브랜드명}"}·{"{담당자명}"} 치환)</label>
          <textarea className="input" rows={3} value={c.sms_template} disabled={!canEdit}
            onChange={(e) => set("sms_template", e.target.value)} />
        </div>
        <div>
          <label className="label">이메일 제목</label>
          <input className="input" value={c.email_subject} disabled={!canEdit} onChange={(e) => set("email_subject", e.target.value)} />
        </div>
        <div>
          <label className="label">이메일 본문 (소개자료 링크를 본문에 넣어 관리하세요)</label>
          <textarea className="input" rows={7} value={c.email_body} disabled={!canEdit} onChange={(e) => set("email_body", e.target.value)} />
        </div>

        {canEdit ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" disabled={pending} onClick={save}>{pending ? "저장 중…" : "저장"}</button>
            {msg && <span className="text-xs" style={{ color: msg.includes("✓") ? "var(--ok)" : "var(--danger)" }}>{msg}</span>}
          </div>
        ) : (
          <div className="note">변경은 파트장/대표만 가능합니다.</div>
        )}
        <div className="note">
          문자 <code>ALIGO_*</code> · 메일 Gmail/<code>RESEND_*</code> 연동이 있어야 실제 발송됩니다. 발송 시 브랜드 타임라인에 접촉 기록이 남습니다.
        </div>
      </div>
    </div>
  );
}
