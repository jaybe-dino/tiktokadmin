"use client";

import { useState, useTransition } from "react";
import { suggestQnaAnswerAction } from "@/app/(dash)/qna/actions";

// [AI 답변 추천] — 승인된 QnA 지식베이스 유사 항목을 근거로 답변 초안을 생성해
// onDraft 로 부모의 답변 textarea 를 채운다. 저장/승인은 기존 액션 담당.
export default function QnaAiButton({
  question,
  category,
  onDraft,
  small = true,
}: {
  question: string;
  category?: string;
  onDraft: (text: string) => void;
  small?: boolean;
}) {
  const [pending, start] = useTransition();
  const [info, setInfo] = useState<{ text: string; bad: boolean } | null>(null);

  function run() {
    setInfo(null);
    const q = (question || "").trim();
    if (!q) {
      setInfo({ text: "질문을 먼저 입력하세요.", bad: true });
      return;
    }
    start(async () => {
      const res = await suggestQnaAnswerAction({ question: q, category });
      if (res.ok && res.draft) {
        onDraft(res.draft);
        setInfo({
          text: res.usedCount
            ? `승인된 QnA ${res.usedCount}건을 근거로 초안 생성 · 검토 후 저장하세요`
            : "관련 근거가 적어 일반 초안으로 생성 · 검토 후 저장하세요",
          bad: false,
        });
      } else {
        setInfo({ text: res.error || "생성 실패", bad: true });
      }
    });
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        className={small ? "btn sm" : "btn"}
        disabled={pending}
        onClick={run}
      >
        {pending ? "생성 중…" : "✨ AI 답변 추천"}
      </button>
      {info && (
        <div className="note" style={{ color: info.bad ? "#b91c1c" : "#7e22ce" }}>
          {info.text}
        </div>
      )}
    </div>
  );
}
