"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setProposalStatusV2Action } from "./actions";

// 목록 행 액션 — 상태 스텝 이동(draft→sent, sent→accepted/rejected) + 기존 링크 보존.
export default function ProposalRowActions({
  id,
  brandId,
  status,
}: {
  id: string;
  brandId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function step(next: string) {
    setErr("");
    start(async () => {
      const r = await setProposalStatusV2Action(id, next, brandId);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "처리 실패");
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {err && (
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)" }}>
          {err}
        </span>
      )}

      {status === "draft" && (
        <>
          <Link href={`/brand/${brandId}`} className="btn sm">
            이어서 작성
          </Link>
          <button
            className="btn sm pri"
            disabled={pending}
            onClick={() => step("sent")}
          >
            {pending ? "…" : "발송"}
          </button>
        </>
      )}

      {status === "sent" && (
        <>
          <button
            className="btn sm"
            disabled={pending}
            onClick={() => step("rejected")}
          >
            거절
          </button>
          <button
            className="btn sm pri"
            disabled={pending}
            onClick={() => step("accepted")}
          >
            {pending ? "…" : "수락"}
          </button>
        </>
      )}

      {status === "accepted" && (
        <Link href="/contracts" className="btn sm">
          계약으로 →
        </Link>
      )}

      {(status === "rejected" || status === "superseded") && (
        <Link href={`/brand/${brandId}`} className="btn sm">
          보기
        </Link>
      )}
    </span>
  );
}
