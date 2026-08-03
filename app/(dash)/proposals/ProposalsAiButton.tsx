"use client";

// 제안서 AI 커스텀 문구 — 견적 빌더의 현재 선택(브랜드·plan·국가·약정)을 넘겨
// 서버액션으로 소개/설득 문구 초안을 생성하고, 복사용 textarea 에 표시한다.
// 실제 제안 생성/발송은 기존 버튼 유지 — 이 컴포넌트는 문구 초안만 만든다.

import { useState, useTransition } from "react";
import type { QuoteTerm } from "@/lib/quote";
import { generateProposalCopyAction } from "./actions";

export default function ProposalsAiButton({
  brandId,
  plan,
  countries,
  term,
}: {
  brandId: string;
  plan: string;
  countries: string[];
  term: QuoteTerm;
}) {
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function run() {
    setErr(null);
    setCopied(false);
    start(async () => {
      const r = await generateProposalCopyAction({
        brand_id: brandId,
        plan,
        countries,
        term,
      });
      if (r.ok) setText(r.text ?? "");
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
    <div className="aiw" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontSize: 12.5 }}>AI 제안 문구</b>
        <button
          type="button"
          className="btn sm"
          onClick={run}
          disabled={pending || !brandId}
        >
          {pending ? "생성 중…" : "AI 문구 생성"}
        </button>
      </div>

      <div className="note" style={{ marginTop: 6 }}>
        선택 브랜드의 카드 맥락(카테고리·단계·목표국·plan)으로 소개/설득 문구 초안을
        만듭니다 — 복사해 제안서에 활용하세요.
      </div>

      {err && (
        <div
          className="note"
          style={{ marginTop: 6, color: "var(--warn)", fontWeight: 700 }}
        >
          {err}
        </div>
      )}

      {text && (
        <>
          <textarea
            className="f"
            style={{ marginTop: 8, minHeight: 160, fontFamily: "inherit" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className="btn sm"
            style={{ marginTop: 6 }}
            onClick={copy}
          >
            {copied ? "복사됨 ✓" : "복사"}
          </button>
        </>
      )}
    </div>
  );
}
