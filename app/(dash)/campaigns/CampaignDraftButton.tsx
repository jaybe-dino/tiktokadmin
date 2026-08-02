"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { generateAllDraftsAction } from "./actions";

// 헤더 "캠페인 초안 생성 (AI)" — 대상이 있는 세그먼트별 draft 캠페인을 만들어
// "승인 대기 캠페인"에 올린다.
export default function CampaignDraftButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      const r = await generateAllDraftsAction();
      if (r.ok) {
        setMsg({
          text: r.made ? `초안 ${r.made}건 생성 — 승인 대기` : "생성할 새 초안이 없습니다.",
          ok: true,
        });
        router.refresh();
      } else {
        setMsg({ text: r.error ?? "생성 실패", ok: false });
      }
      window.setTimeout(() => setMsg(null), 3200);
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button className="btn btn-sm btn-primary" disabled={pending} onClick={run}>
        {pending ? "생성 중…" : "캠페인 초안 생성 (AI)"}
      </button>
      {msg && (
        <span
          className="pill"
          style={{ fontSize: 11, fontWeight: 700, color: msg.ok ? "var(--ok)" : "var(--warn)" }}
        >
          {msg.text}
        </span>
      )}
    </span>
  );
}
