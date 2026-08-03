"use client";

// v3.1 개요 좌측 — "미팅 후 설문 응답" 카드. surveys(14-A) 실데이터.
// 응답 전이면 설문 링크 생성/복사(createSurveyAction) 배선.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSurveyAction } from "@/app/actions";

interface SurveyLite {
  token: string;
  sent_at: string | null;
  responded_at: string | null;
  answers: Record<string, unknown>;
}

const A = (v: unknown): string => (typeof v === "string" && v.trim() ? v : "—");

export default function Brand360SurveyCard({ brandId, survey }: { brandId: string; survey: SurveyLite | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const answered = Boolean(survey?.responded_at);
  const ans = (survey?.answers ?? {}) as Record<string, unknown>;
  const consent = ans.marketing_consent;

  return (
    <div className="card">
      <div className="hd">
        <b>미팅 후 설문 응답</b>
        {answered ? (
          <span className="chip grn">응답 완료 {survey!.responded_at!.slice(5, 10).replace("-", "/")}</span>
        ) : survey ? (
          <span className="chip amb">응답 대기</span>
        ) : (
          <span className="chip">미발송</span>
        )}
        {!answered && (
          <div className="rt">
            <button
              className="btn sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (survey) {
                    setUrl(`/s/${survey.token}`);
                    return;
                  }
                  const r = await createSurveyAction(brandId);
                  if (r.ok && r.url) { setUrl(r.url); setMsg("설문 링크 생성됨"); }
                  else setMsg(r.error ?? "실패");
                  router.refresh();
                })
              }
            >
              {survey ? "링크 보기" : "+ 설문 링크 생성"}
            </button>
          </div>
        )}
      </div>
      <div className="bd">
        {answered ? (
          <div className="kv">
            <dt>예산대</dt><dd>{A(ans.budget_band)}</dd>
            <dt>시딩 여력</dt><dd>{A(ans.seeding_capacity)}</dd>
            <dt>목표 시작</dt><dd>{A(ans.timeline)}</dd>
            <dt>우려</dt><dd>{A(ans.concerns)}</dd>
            <dt>수신 동의</dt>
            <dd style={{ color: consent === true ? "var(--ok)" : "var(--ink3)" }}>
              {consent === true ? "✓ 마케팅 수신 동의" : consent === false ? "미동의" : "—"}
            </dd>
          </div>
        ) : (
          <p className="note">
            {survey
              ? `설문 발송됨(${survey.sent_at ? survey.sent_at.slice(0, 10) : "발송일 미기록"}) — 응답 대기 중입니다.`
              : "미팅 후 마케팅 설문이 아직 없습니다 — 링크를 생성해 팔로업 메일에 넣으세요."}
          </p>
        )}
        {url && (
          <div className="note" style={{ marginTop: 8 }}>
            공개 링크: <a href={url} target="_blank" style={{ color: "var(--acc)", fontWeight: 700 }}>{url}</a>
          </div>
        )}
        {msg && <div className="note" style={{ marginTop: 6 }}>{msg}</div>}
      </div>
    </div>
  );
}
