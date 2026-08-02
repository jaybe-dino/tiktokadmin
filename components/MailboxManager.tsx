"use client";
import { useState, useTransition } from "react";
import type { SharedMailbox } from "@/lib/shared-mailboxes";
import { addMailboxAction, toggleMailboxAction, removeMailboxAction } from "@/app/actions";

export default function MailboxManager({ mailboxes, canEdit }: { mailboxes: SharedMailbox[]; canEdit: boolean }) {
  const [rows, setRows] = useState(mailboxes);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const refreshLocal = (email: string, patch: Partial<SharedMailbox>) =>
    setRows((rs) => rs.map((r) => (r.email === email ? { ...r, ...patch } : r)));

  return (
    <div className="card">
      <div className="card-hd">
        <b>회사 공용 메일함</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>고객 커뮤 수집 대상 · {rows.length}개</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr><th>메일함</th><th>표시명</th><th>수집</th><th>담당자 전달</th><th></th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.email}>
                <td><b>{m.email}</b>{m.last_sync_at && <span className="sub">최근 수집 {new Date(m.last_sync_at).toLocaleString("ko-KR")}</span>}</td>
                <td style={{ color: "var(--ink3)" }}>{m.label || "—"}</td>
                <td>
                  <span className={`tgl ${m.enabled ? "on" : ""}`} onClick={() => canEdit && start(async () => {
                    const r = await toggleMailboxAction(m.email, "enabled", !m.enabled);
                    if (r.ok) refreshLocal(m.email, { enabled: !m.enabled });
                  })} title="수집 on/off" />
                </td>
                <td>
                  <span className={`tgl ${m.forward_to_owner ? "on" : ""}`} onClick={() => canEdit && start(async () => {
                    const r = await toggleMailboxAction(m.email, "forward", !m.forward_to_owner);
                    if (r.ok) refreshLocal(m.email, { forward_to_owner: !m.forward_to_owner });
                  })} title="수신 시 현재 단계 담당자 자동 전달" />
                </td>
                <td>
                  {canEdit && <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
                    if (!confirm(`${m.email} 삭제?`)) return;
                    const r = await removeMailboxAction(m.email);
                    if (r.ok) setRows((rs) => rs.filter((x) => x.email !== m.email));
                  })}>삭제</button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>등록된 공용 메일함이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label className="label">메일함 주소</label><input className="input" style={{ width: 220 }} placeholder="sales@dinostudio.kr" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label">표시명</label><input className="input" style={{ width: 160 }} placeholder="영업 대표 메일" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={pending || !email} onClick={() => start(async () => {
            setMsg("");
            const r = await addMailboxAction(email, label);
            if (r.ok) { setRows((rs) => [...rs, { email: email.toLowerCase(), label, enabled: true, forward_to_owner: true, note: "", last_sync_at: null, created_at: new Date().toISOString() }]); setEmail(""); setLabel(""); }
            else setMsg(r.error ?? "실패");
          })}>{pending ? "처리 중…" : "추가"}</button>
          {msg && <span className="text-bad" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      )}
      <div className="note" style={{ margin: "0 16px 14px" }}>
        회사 공용 메일함으로 온 고객 메일은 자동으로 고객(브랜드)과 매칭돼 커뮤 타임라인·AI 예상답변으로 정리되고,
        <b> 현재 단계 담당자가 지정돼 있으면 그 담당자에게 자동 전달</b>됩니다. (Gmail 도메인위임 <code>GOOGLE_SA_KEY_JSON</code>, 전달 발송 <code>RESEND_API_KEY</code> 필요)
      </div>
    </div>
  );
}
