"use client";

// [AI 다음 액션 제안] — 브랜드360 개요 우측 도우미 카드.
// 브랜드 맥락(브리프·현재 단계·기존 다음액션·최근 메일)을 서버액션으로 요약해
// 담당자가 취할 다음 액션 제안을 초안 textarea 에 채운다.
// 실제 상태 전이·게이트 판정은 기존 액션 담당 — 이 컴포넌트는 제안 문구만 만든다.

import { useState, useTransition } from "react";
import { suggestNextActionsAction } from "@/app/(dash)/brand360/actions";

export default function Brand360AiButton({ brandId }: { brandId: string }) {
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function run() {
    setErr(null);
    setCopied(false);
    start(async () => {
      const r = await suggestNextActionsAction(brandId);
      if (r.ok) setText(r.draft ?? "");
      else setErr(r.error ?? "생성 실패");
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="aiw">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontSize: 12.5 }}>🤖 AI 도우미 · 다음 액션 제안</b>
        <button type="button" className="btn sm" onClick={run} disabled={pending}>
          {pending ? "생성 중…" : "✨ AI 제안"}
        </button>
      </div>

      <div className="note" style={{ marginTop: 6 }}>
        브리프·현재 단계·다음 액션·최근 메일(실데이터)로 지금 취할 다음 액션을 제안합니다 —
        검토 후 활용하세요.
      </div>

      {err && (
        <div className="note" style={{ marginTop: 6, color: "var(--warn)", fontWeight: 700 }}>
          {err}
        </div>
      )}

      {text && (
        <>
          <textarea
            className="f"
            style={{ marginTop: 8, minHeight: 180, fontFamily: "inherit" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={copy}>
            {copied ? "복사됨 ✓" : "복사"}
          </button>
        </>
      )}
    </div>
  );
}
