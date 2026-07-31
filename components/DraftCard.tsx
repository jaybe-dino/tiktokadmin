"use client";
import { useState, useTransition } from "react";
import type { EmailDraft } from "@/lib/drafts";
import { approveDraftAction, discardDraftAction } from "@/app/actions";

const KIND_KO: Record<string, string> = {
  followup: "팔로업", reminder: "리마인더", payment_notice: "결제안내", reply: "답장",
};

export default function DraftCard({ draft }: { draft: EmailDraft }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [gone, setGone] = useState(false);
  if (gone) return null;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="pill bg-[#fff0f6] text-pink">{KIND_KO[draft.kind] ?? draft.kind}</span>
        <span className="font-medium">{draft.brand_name}</span>
        <span className="text-xs text-muted">→ {draft.to_email || "이메일 없음"}</span>
      </div>
      <div className="text-sm font-semibold">{draft.subject}</div>
      <pre className="text-sm text-muted mt-2 whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-50 p-3 rounded">{draft.body_md}</pre>
      {msg && <p className="text-sm mt-2 text-bad">{msg}</p>}
      <div className="flex gap-2 mt-3">
        <button className="btn btn-primary" disabled={pending || !draft.to_email}
          onClick={() => start(async () => {
            const r = await approveDraftAction(draft.id);
            if (r.ok) { if (r.sent) setGone(true); else setMsg("승인됨(발송 미설정 — Resend 필요)"); }
            else setMsg(r.error ?? "실패");
          })}>
          {pending ? "처리 중…" : "승인·발송"}
        </button>
        <button className="btn" disabled={pending}
          onClick={() => start(async () => { await discardDraftAction(draft.id); setGone(true); })}>
          발송 안함
        </button>
      </div>
    </div>
  );
}
