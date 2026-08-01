"use client";
import { useState, useTransition } from "react";
import { composeEmailAction } from "@/app/actions";

// 고객카드에서 대화맥락 기반 AI 메일 초안 생성 → 초안함으로.
export default function ComposeEmailButton({ brandId }: { brandId: string }) {
  const [intent, setIntent] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-hd"><b>✍️ AI 메일 초안</b><span className="ml-auto text-[11px]" style={{ color: "var(--ink3)" }}>카드·미팅·메일 맥락 반영</span></div>
      <div style={{ padding: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" style={{ flex: 1, minWidth: 180 }} value={intent}
          onChange={(e) => setIntent(e.target.value)} placeholder="의도(선택): 예) 제안 팔로업 / 서류 재요청 / 정산 안내" />
        <button className="btn btn-primary" disabled={pending}
          onClick={() => start(async () => {
            const r = await composeEmailAction(brandId, intent || undefined);
            setMsg(r.ok ? `초안 생성됨 → 초안함에서 검토·발송 (${r.subject})` : (r.error ?? "실패"));
          })}>
          {pending ? "생성 중…" : "AI 초안 생성"}
        </button>
        {msg && <div className="note" style={{ width: "100%" }}>{msg}</div>}
      </div>
    </div>
  );
}
