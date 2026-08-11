"use client";

// 오늘(today) 화면 버튼 배선 — v3.1 s-home.
//  · ApproveSendButton: 초안 [승인·발송] → approveDraftAction(canSend 게이트 경유).
//  · ApproveRejectButtons: 결재 요청 [승인]/[거절] → /api/ops/approve (lead·exec 권한 검사).
//  · AcceptLeadButton: 유입알림 [담당 수락] → acceptLeadAction(현재 사용자를 영업 담당으로).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDraftAction, discardDraftAction, deleteApprovalRequestAction } from "@/app/actions";
import { acceptLeadAction } from "./actions";

/** 결재 요청 삭제(파트장/대표) — 홈 승인대기 목록에서 제거. */
export function DeleteApprovalButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  const [err, setErr] = useState("");
  if (gone) return <span className="chip" style={{ color: "var(--ink3)" }}>삭제됨</span>;
  return (
    <>
      {err && <span style={{ color: "var(--danger)", fontSize: 11 }}>{err}</span>}
      <button
        className="btn sm"
        style={{ color: "var(--danger)" }}
        disabled={pending}
        title="이 결재 요청을 삭제합니다 (파트장/대표)"
        onClick={() => {
          if (!confirm("이 결재 요청을 삭제할까요?")) return;
          start(async () => {
            const r = await deleteApprovalRequestAction(id);
            if (r.ok) { setGone(true); router.refresh(); }
            else setErr(r.error ?? "삭제 실패");
          });
        }}
      >
        {pending ? "…" : "삭제"}
      </button>
    </>
  );
}

/** AI가 준비한 초안 삭제(폐기) — status='discarded'. 확인 후 목록에서 제거. */
export function DiscardDraftButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return <span className="chip" style={{ color: "var(--ink3)" }}>삭제됨</span>;
  return (
    <button
      className="btn sm"
      style={{ color: "var(--danger)" }}
      disabled={pending}
      title="이 AI 초안을 삭제합니다"
      onClick={() => {
        if (!confirm("이 초안을 삭제할까요?")) return;
        start(async () => {
          const r = await discardDraftAction(id);
          if (r.ok) { setGone(true); router.refresh(); }
        });
      }}
    >
      {pending ? "…" : "삭제"}
    </button>
  );
}

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
