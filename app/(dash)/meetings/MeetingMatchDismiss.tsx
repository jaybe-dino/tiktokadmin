"use client";
// '매칭 필요' 목록에서 무시/복원 — 미팅 자체는 삭제하지 않음.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissMeetingMatchAction, restoreMeetingMatchAction } from "./actions";

export function MeetingDismissButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn sm"
      disabled={pending}
      title="이 미팅을 '매칭 필요' 목록에서만 제외합니다(미팅은 유지)"
      onClick={() => start(async () => { await dismissMeetingMatchAction(meetingId); router.refresh(); })}
    >
      {pending ? "…" : "목록에서 제거"}
    </button>
  );
}

export function MeetingRestoreButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn sm"
      disabled={pending}
      title="다시 '매칭 필요' 목록으로 복원"
      onClick={() => start(async () => { await restoreMeetingMatchAction(meetingId); router.refresh(); })}
    >
      {pending ? "…" : "복원"}
    </button>
  );
}
