"use client";

import { useState, useTransition } from "react";
import { setInsightApprovalAction } from "./actions";

/** 인사이트 제안 승인/보류 버튼 (파트장/대표). 결과·에러 표시. */
export default function InsightApproval({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const act = (approved: boolean) =>
    start(async () => {
      setMsg("");
      const r = await setInsightApprovalAction(id, approved);
      if (!r.ok) setMsg(`✗ ${r.error ?? "실패"}`);
    });

  return (
    <>
      <button className="btn sm grn" disabled={pending} onClick={() => act(true)}>
        {pending ? "처리 중…" : "승인"}
      </button>
      <button className="btn sm" disabled={pending} onClick={() => act(false)}>
        보류
      </button>
      {msg && (
        <span className="text-[11px]" style={{ color: "var(--danger)" }}>
          {msg}
        </span>
      )}
    </>
  );
}
