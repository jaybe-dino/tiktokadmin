"use client";
import { useState, useTransition } from "react";
import { testNotifyAction } from "@/app/actions";

export interface IntegrationStatus {
  aligo: boolean; aligoTest: boolean; resend: boolean;
  anthropic: boolean; openai: boolean; gmail: boolean; slack: boolean;
}

function Chip({ on, label }: { on: boolean; label: string }) {
  return <span className={`pill ${on ? "chip-grn" : "chip-red"}`}>{on ? "연결됨" : "미설정"} · {label}</span>;
}

export default function TestNotify({ status, canEdit }: { status: IntegrationStatus; canEdit: boolean }) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [res, setRes] = useState<{ sms?: string; email?: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="card">
      <div className="card-hd"><b>연동 상태 · 테스트 발송</b><span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: "auto" }}>키는 Vercel 환경변수</span></div>
      <div className="card-bd" style={{ display: "grid", gap: 12 }}>
        <div className="tagz">
          <Chip on={status.aligo} label={`문자(ALIGO)${status.aligo && status.aligoTest ? " · 테스트모드" : ""}`} />
          <Chip on={status.resend} label="메일(RESEND)" />
          <Chip on={status.anthropic} label="AI(ANTHROPIC)" />
          <Chip on={status.openai} label="전사(OpenAI/Groq)" />
          <Chip on={status.gmail} label="메일수집(Gmail)" />
          <Chip on={status.slack} label="Slack" />
        </div>

        {canEdit && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label className="label">내 휴대폰(문자 테스트)</label><input className="input" placeholder="01012345678" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div><label className="label">내 이메일(메일 테스트)</label><input className="input" placeholder="me@company.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn btn-primary" disabled={pending || (!phone && !email)} onClick={() => start(async () => {
                setRes(null);
                const r = await testNotifyAction({ phone, email });
                if (r.ok) setRes({ sms: r.sms, email: r.email }); else setRes({ sms: r.error });
              })}>{pending ? "발송 중…" : "테스트 발송"}</button>
              {res && (
                <span className="text-xs" style={{ color: "var(--ink2)" }}>
                  {res.sms && <span style={{ marginRight: 10 }}>문자: {res.sms}</span>}
                  {res.email && <span>메일: {res.email}</span>}
                </span>
              )}
            </div>
          </>
        )}
        <div className="note">
          문자는 <code>ALIGO_API_KEY·ALIGO_USER_ID·ALIGO_SENDER</code>(안전 테스트는 <code>ALIGO_TEST_MODE=Y</code>), 메일은 <code>RESEND_API_KEY·RESEND_FROM</code> 키가 필요합니다. 위 상태 칩이 "연결됨"이어야 실제 발송됩니다.
        </div>
      </div>
    </div>
  );
}
