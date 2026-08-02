"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { approveCampaignAction, cancelCampaignAction } from "./actions";

// "승인 대기 캠페인" 행 액션 — 승인·예약(draft→queued) / 취소(→canceled).
export default function CampaignApprove({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function act(kind: "approve" | "cancel") {
    setErr("");
    start(async () => {
      const r =
        kind === "approve"
          ? await approveCampaignAction(id)
          : await cancelCampaignAction(id);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "처리 실패");
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {err && (
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)" }}>{err}</span>
      )}
      <button className="btn btn-sm" disabled={pending} onClick={() => act("cancel")}>
        취소
      </button>
      <button
        className="btn btn-sm btn-primary"
        disabled={pending}
        onClick={() => act("approve")}
      >
        {pending ? "처리 중…" : "승인·예약"}
      </button>
    </span>
  );
}
