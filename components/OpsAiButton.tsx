"use client";

// [AI 월간 리포트 초안] — 이번 달 운영 사이클 지표(opsDashboard 실데이터)를
// 서버액션으로 요약해 월간 성과 리포트 초안을 만들고, 복사/저장용 textarea 에 표시한다.
// 실제 사이클 마감·정산은 기존 크론/액션 담당 — 이 컴포넌트는 문구 초안만 만든다.

import { useState, useTransition } from "react";
import { generateMonthlyReportAction } from "@/app/(dash)/ops/actions";

export default function OpsAiButton({ month }: { month: string }) {
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function run() {
    setErr(null);
    setCopied(false);
    start(async () => {
      const r = await generateMonthlyReportAction({ month });
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
    <div className="aiw" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontSize: 12.5 }}>AI 월간 성과 리포트 초안</b>
        <button type="button" className="btn sm" onClick={run} disabled={pending}>
          {pending ? "생성 중…" : "✨ AI 리포트 초안"}
        </button>
      </div>

      <div className="note" style={{ marginTop: 6 }}>
        이번 달 브랜드수·이행률·시딩/라이브 이행 현황(실데이터)으로 월간 성과 리포트
        초안을 만듭니다 — 복사해 공유/저장에 활용하세요.
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
            style={{ marginTop: 8, minHeight: 220, fontFamily: "inherit" }}
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
