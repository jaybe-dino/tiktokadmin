"use client";

// v3.1 개요 좌측 — 설문 카드. surveys(14-A) 실데이터.
// · 사전 설문(kind='pre_meeting', 기획확정 8절): 링크 생성 + 요청 메일 초안(초안함 경유) — sendPreSurveyAction
// · 미팅 후 설문(post_meeting): 기존 createSurveyAction 유지
// · 응답 완료 시 kind 별 요약 표시(1:1 미팅 사전학습용)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSurveyAction } from "@/app/actions";
import { sendPreSurveyAction } from "@/app/(dash)/brand360/survey-actions";
import { PRE_MEETING_QUESTIONS, surveyKindLabel } from "@/lib/survey";

interface SurveyLite {
  token: string;
  kind?: string; // pre_meeting|post_meeting(기본)
  sent_at: string | null;
  responded_at: string | null;
  answers: Record<string, unknown>;
}

const A = (v: unknown): string => (typeof v === "string" && v.trim() ? v : "—");
const M = (v: unknown): string => (Array.isArray(v) && v.length > 0 ? (v as string[]).join(", ") : "—");

export default function Brand360SurveyCard({ brandId, survey }: { brandId: string; survey: SurveyLite | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const answered = Boolean(survey?.responded_at);
  const isPre = survey?.kind === "pre_meeting";
  const kindLabel = surveyKindLabel(survey?.kind);
  const ans = (survey?.answers ?? {}) as Record<string, unknown>;
  const consent = ans.marketing_consent;

  const sendPre = () =>
    start(async () => {
      const r = await sendPreSurveyAction(brandId);
      if (r.ok && r.url) {
        setUrl(r.url);
        setMsg(r.reusedDraft
          ? "기존 사전 설문 링크·메일 초안 재사용 — 초안함에서 검토·발송하세요."
          : "사전 설문 링크 + 요청 메일 초안 생성됨 — 초안함에서 검토·발송하세요.");
      } else setMsg(r.error ?? "실패");
      router.refresh();
    });

  return (
    <div className="card">
      <div className="hd">
        <b>설문 · 1:1 사전학습</b>
        {answered ? (
          <span className="chip grn">{kindLabel} 응답 완료 {survey!.responded_at!.slice(5, 10).replace("-", "/")}</span>
        ) : survey ? (
          <span className="chip amb">{kindLabel} 응답 대기</span>
        ) : (
          <span className="chip">미발송</span>
        )}
        <div className="rt" style={{ display: "flex", gap: 6 }}>
          {!(isPre && answered) && (
            <button className="btn sm" disabled={pending} onClick={sendPre}>
              사전 설문 보내기
            </button>
          )}
          {!answered && (
            <button
              className="btn sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (survey && !isPre) {
                    setUrl(`/s/${survey.token}`);
                    return;
                  }
                  const r = await createSurveyAction(brandId);
                  if (r.ok && r.url) { setUrl(r.url); setMsg("미팅 후 설문 링크 생성됨"); }
                  else setMsg(r.error ?? "실패");
                  router.refresh();
                })
              }
            >
              {survey && !isPre ? "링크 보기" : "+ 미팅 후 설문"}
            </button>
          )}
        </div>
      </div>
      <div className="bd">
        {answered && isPre ? (
          <>
            <div className="kv">
              {PRE_MEETING_QUESTIONS.map((q) => (
                <span key={q.key} style={{ display: "contents" }}>
                  <dt>{q.label.replace(/\(.*\)$/, "")}</dt>
                  <dd>{q.type === "multi" ? M(ans[q.key]) : A(ans[q.key])}</dd>
                </span>
              ))}
            </div>
            <p className="note" style={{ marginTop: 8 }}>
              1:1 미팅 사전학습용 — 회사정보(사업자번호·회사명·주소)는 비어 있는 값에 한해 원장(brands·brand_company)에 자동 반영됩니다.
            </p>
          </>
        ) : answered ? (
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
              ? `${kindLabel} 발송됨(${survey.sent_at ? survey.sent_at.slice(0, 10) : "발송일 미기록"}) — 응답 대기 중입니다.`
              : "설문이 아직 없습니다 — 1:1 미팅 전이라면 '사전 설문 보내기'로 링크 생성 + 요청 메일 초안(초안함)을 만드세요."}
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
