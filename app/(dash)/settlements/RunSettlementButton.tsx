"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runSettlementDraftAction } from "./actions";

// 헤더 "정산 런 실행" — 활성 사이클 마감 + 정산 draft 생성(멱등). 파트장/대표만.
export default function RunSettlementButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  function run() {
    setMsg("");
    setErr("");
    start(async () => {
      const r = await runSettlementDraftAction();
      if (r.ok) {
        setMsg(`초안 ${r.created ?? 0}건 생성 · 사이클 ${r.closed ?? 0}건 마감`);
        router.refresh();
      } else {
        setErr(r.error ?? "처리 실패");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[11px]" style={{ color: "var(--danger)" }}>{err}</span>}
      {msg && <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{msg}</span>}
      <button className="btn pri" disabled={pending} onClick={run}>
        {pending ? "실행중…" : "정산 런 실행"}
      </button>
    </div>
  );
}
