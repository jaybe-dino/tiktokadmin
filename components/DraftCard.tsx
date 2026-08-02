"use client";
import { useState, useTransition } from "react";
import type { EmailDraft } from "@/lib/drafts";
import { approveDraftAction, discardDraftAction } from "@/app/actions";

const KIND_KO: Record<string, string> = {
  followup: "팔로업", reminder: "리마인더", payment_notice: "결제안내",
  reply: "답장", reply_transactional: "자동회신", doc_request: "서류요청", settlement: "정산안내",
};
const SOURCE_KO: Record<string, string> = {
  inbound_agent: "🤖 인바운드 자동", meeting: "미팅 팔로업", contextual: "AI 맥락", manual: "수동",
};

export default function DraftCard({ draft }: { draft: EmailDraft }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [gone, setGone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body_md);
  if (gone) return null;

  const dirty = subject !== draft.subject || body !== draft.body_md;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="pill bg-[#fff0f6] text-pink">{KIND_KO[draft.kind] ?? draft.kind}</span>
        {draft.source && <span className="pill bg-gray-100 text-muted text-[11px]">{SOURCE_KO[draft.source] ?? draft.source}</span>}
        <span className="font-medium">{draft.brand_name}</span>
        <span className="text-xs text-muted">→ {draft.to_email || "이메일 없음"}</span>
      </div>

      {/* 인바운드 요약(담당 검토용) — 자동회신 초안일 때 */}
      {draft.context_summary && (
        <div className="text-xs mb-2 p-2 rounded" style={{ background: "#f0f6ff", color: "#1e3a5f" }}>
          <b>📩 고객 메일 요약</b>
          <div className="mt-1 whitespace-pre-wrap">{draft.context_summary}</div>
        </div>
      )}

      {editing ? (
        <div className="space-y-2">
          <input className="w-full border rounded px-2 py-1 text-sm font-semibold"
            value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="제목" />
          <textarea className="w-full border rounded px-2 py-2 text-sm h-48 font-mono"
            value={body} onChange={(e) => setBody(e.target.value)} placeholder="본문" />
        </div>
      ) : (
        <>
          <div className="text-sm font-semibold">{subject}</div>
          <pre className="text-sm text-muted mt-2 whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-50 p-3 rounded">{body}</pre>
        </>
      )}

      {msg && <p className="text-sm mt-2 text-bad">{msg}</p>}

      <div className="flex gap-2 mt-3 flex-wrap">
        <button className="btn btn-primary" disabled={pending || !draft.to_email}
          onClick={() => start(async () => {
            setMsg("");
            const edits = dirty ? { subject, body } : undefined;
            const r = await approveDraftAction(draft.id, edits);
            if (r.ok) { if (r.sent) setGone(true); else setMsg("승인됨(발송 미설정 — Resend 필요)"); }
            else setMsg(r.error ?? "실패");
          })}>
          {pending ? "처리 중…" : dirty ? "수정 후 승인·발송" : "승인·발송"}
        </button>
        <button className="btn" disabled={pending} onClick={() => setEditing((v) => !v)}>
          {editing ? "미리보기" : "✏️ 수정"}
        </button>
        <button className="btn" disabled={pending}
          onClick={() => start(async () => { await discardDraftAction(draft.id); setGone(true); })}>
          발송 안함
        </button>
      </div>
    </div>
  );
}
