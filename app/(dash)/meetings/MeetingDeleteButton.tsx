"use client";
// 미팅 삭제 버튼(작은 인라인) — 매칭 필요 등 목록에서 개별 삭제.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMeetingAction } from "./actions";

export default function MeetingDeleteButton({ meetingId, label = "삭제" }: { meetingId: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn sm"
      style={{ color: "var(--bad)" }}
      disabled={pending}
      onClick={() => {
        if (!confirm("이 미팅을 삭제할까요? 완전히 제거됩니다.")) return;
        start(async () => { await deleteMeetingAction(meetingId); router.refresh(); });
      }}
    >
      {pending ? "삭제 중…" : label}
    </button>
  );
}
