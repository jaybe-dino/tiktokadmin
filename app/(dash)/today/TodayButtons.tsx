"use client";

// 오늘(today) 화면 버튼 배선 — v3.1 s-home.
//  · ApproveSendButton: 초안 [승인·발송] → approveDraftAction(canSend 게이트 경유).
//  · ApproveRejectButtons: 결재 요청 [승인]/[거절] → /api/ops/approve (lead·exec 권한 검사).
//  · AcceptLeadButton: 유입알림 [담당 수락] → acceptLeadAction(현재 사용자를 영업 담당으로).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDraftAction } from "@/app/actions";
import { acceptLeadAction } from "./actions";

export function ApproveSendButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <span className="chip grn">발송됨</span>;
  return (
    <>
      {msg && <span style={{ color: "var(--danger)", fontSize: 11 }}>{msg}</span>}
      <button
        className="btn sm grn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("");
            const r = await approveDraftAction(id);
            if (r.ok) {
              if (r.sent) { setDone(true); router.refresh(); }
              else setMsg("승인됨(발송 미설정 — Resend 필요)");
            } else setMsg(r.error ?? "실패");
          })
        }
      >
        {pending ? "처리 중…" : "승인·발송"}
      </button>
    </>
  );
}

export function AcceptLeadButton({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <span className="chip grn">수락됨</span>;
  return (
    <>
      <button
        className="btn sm pri"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("");
            const r = await acceptLeadAction(brandId);
            if (r.ok) { setDone(true); router.refresh(); }
            else setMsg(r.error ?? "실패");
          })
        }
      >
        {pending ? "처리 중…" : "담당 수락"}
      </button>
      {msg && <span style={{ color: "var(--danger)", fontSize: 11, alignSelf: "center" }}>{msg}</span>}
    </>
  );
}
