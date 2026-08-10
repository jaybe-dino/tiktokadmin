"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stepContractStatusAction } from "./actions";
import PaymentNoticeButton from "./PaymentNoticeButton";

// 계약 목록 행 액션 — 상태 스텝 이동 + 결제안내 발송(내용 확인) + 기존 "보기" 링크 보존.
export default function ContractRowActions({
  id,
  brandId,
  status,
  paymentItem = "결제",
}: {
  id: string;
  brandId: string;
  status: string;
  paymentItem?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function step(next: string) {
    setErr("");
    start(async () => {
      const r = await stepContractStatusAction(id, brandId, next);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "처리 실패");
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {err && (
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)" }}>{err}</span>
      )}

      {status === "draft" && (
        <button className="btn sm" disabled={pending} onClick={() => step("review")}>
          {pending ? "…" : "검토 요청"}
        </button>
      )}
      {(status === "draft" || status === "review") && (
        <button className="btn sm pri" disabled={pending} onClick={() => step("sent")}>
          {pending ? "…" : "발송"}
        </button>
      )}
      {status === "sent" && (
        <>
          <button className="btn sm pri" disabled={pending} onClick={() => step("signed")}>
            {pending ? "…" : "서명 완료"}
          </button>
          <button className="btn sm" disabled={pending} onClick={() => { if (confirm("이 계약을 만료 처리할까요?")) step("expired"); }}>
            만료
          </button>
        </>
      )}
      {(status === "sent" || status === "signed") && (
        <button className="btn sm" disabled={pending} style={{ color: "var(--danger)" }}
          onClick={() => { if (confirm("이 계약을 해지 처리할까요?")) step("terminated"); }}>
          해지
        </button>
      )}

      {/* 결제 안내 발송 — 리스팅에서 내용 확인 후 발송 */}
      <PaymentNoticeButton brandId={brandId} item={paymentItem} />

      <Link href={`/brand/${brandId}`} className="btn sm">보기</Link>
    </span>
  );
}
