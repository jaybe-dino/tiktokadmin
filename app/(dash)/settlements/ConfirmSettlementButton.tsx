"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmSettlementAction } from "./actions";

// 초안(draft) 정산 확정 — draft → confirmed (파트장/대표 결재).
export default function ConfirmSettlementButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function confirm() {
    setErr("");
    start(async () => {
      const r = await confirmSettlementAction(id);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "처리 실패");
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {err && <span className="text-[11px]" style={{ color: "var(--danger)" }}>{err}</span>}
      <button className="btn sm pri" disabled={pending} onClick={confirm}>
        {pending ? "…" : "확정"}
      </button>
    </span>
  );
}
