"use client";
import { useState, useTransition } from "react";
import type { WelcomeConfig } from "@/lib/welcome";
import { saveWelcomeConfigAction } from "@/app/actions";

const SOURCE_OPTIONS: { key: string; label: string }[] = [
  { key: "meta_ads", label: "메타/페북 광고" },
  { key: "glovek_consult", label: "Glovek 상담" },
  { key: "glovek_inquiry", label: "Glovek 문의" },
  { key: "apply_consult", label: "apply 상담" },
  { key: "tp_seminar", label: "tp 세미나" },
  { key: "tp_ebook", label: "tp 전자책" },
];

export default function WelcomeConfigCard({ config, canEdit }: { config: WelcomeConfig; canEdit: boolean }) {
  const [c, setC] = useState(config);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const set = <K extends keyof WelcomeConfig>(k: K, v: WelcomeConfig[K]) => setC((p) => ({ ...p, [k]: v }));
  const toggleSource = (k: string) =>
    setC((p) => ({ ...p, sources: p.sources.includes(k) ? p.sources.filter((s) => s !== k) : [...p.sources, k] }));

  const save = () => start(async () => {
    setMsg("");
    const r = await saveWelcomeConfigAction(c);
    setMsg(r.ok ? "저장됨 ✓" : r.error ?? "실패");
  });

  return (
    <div className="card">
      <div className="card-hd">
        <b>신규 리드 자동 안내</b>
        <span className={`chip ${c.enabled ? "chip-grn" : "chip-amb"}`} style={{ marginLeft: "auto" }}>{c.enabled ? "자동 발송 ON" : "OFF"}</span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${c.enabled ? "on" : ""}`} onClick={() => canEdit && set("enabled", !c.enabled)} /> 자동 발송
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${c.send_sms ? "on" : ""}`} onClick={() => canEdit && set("send_sms", !c.send_sms)} /> 문자(SMS)
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${c.send_email ? "on" : ""}`} onClick={() => canEdit && set("send_email", !c.send_email)} /> 이메일
          </label>
        </div>

        <div>
          <label className="label">자동 대상 유입 소스 (체크된 DB만 발송)</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SOURCE_OPTIONS.map((s) => (
              <button key={s.key} type="button" disabled={!canEdit}
                onClick={() => toggleSource(s.key)}
                className={`pill ${c.sources.includes(s.key) ? "chip-grn" : ""}`}
                style={{ cursor: canEdit ? "pointer" : "default", border: "1px solid var(--line)" }}>
                {c.sources.includes(s.key) ? "✓ " : ""}{s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">문자 템플릿 ({"{브랜드명}"} 치환)</label>
          <textarea className="input" rows={2} value={c.sms_template} disabled={!canEdit}
            onChange={(e) => set("sms_template", e.target.value)} />
        </div>
        <div>
          <label className="label">이메일 제목</label>
          <input className="input" value={c.email_subject} disabled={!canEdit} onChange={(e) => set("email_subject", e.target.value)} />
        </div>
        <div>
          <label className="label">이메일 본문</label>
          <textarea className="input" rows={4} value={c.email_body} disabled={!canEdit} onChange={(e) => set("email_body", e.target.value)} />
        </div>

        {canEdit && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" disabled={pending} onClick={save}>{pending ? "저장 중…" : "저장"}</button>
            {msg && <span className="text-xs" style={{ color: msg.includes("✓") ? "var(--ok)" : "var(--danger)" }}>{msg}</span>}
          </div>
        )}
        <div className="note">
          유입 즉시 대상 소스면 <b>문자·이메일 1회 자동 발송</b>(고객이 먼저 문의한 거래성 응답). 문자는 <code>ALIGO_*</code>, 메일은 <code>RESEND_*</code> 키 필요.
          메타/페북 광고 리드는 소스 <code>meta_ads</code> 로 유입 시 자동 포함됩니다.
        </div>
      </div>
    </div>
  );
}
