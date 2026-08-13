"use client";

// v3.1 개요 좌측 — 설문 카드. surveys(14-A) 실데이터.
// · 사전 설문(kind='pre_meeting', 기획확정 8절): 링크 생성 + 요청 메일 초안(초안함 경유) — sendPreSurveyAction
// · 미팅 후 설문(post_meeting): 기존 createSurveyAction 유지
// · 응답 완료 시 kind 별 '모든 문항' 세부내용 표시(누락 필수 항목 경고). 과거 설문 이력 전체 열람.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSurveyAction } from "@/app/actions";
import { sendPreSurveyAction } from "@/app/(dash)/brand360/survey-actions";
import {
  type SurveyQuestion,
  questionsForKind,
  surveyKindLabel,
  missingRequired,
} from "@/lib/survey";

interface SurveyLite {
  id?: string;
  token: string;
  kind?: string; // pre_meeting|post_meeting(기본)
  sent_at: string | null;
  responded_at: string | null;
  created_at?: string;
  answers: Record<string, unknown>;
}

const A = (v: unknown): string => (typeof v === "string" && v.trim() ? v : "—");
const M = (v: unknown): string => (Array.isArray(v) && v.length > 0 ? (v as string[]).join(", ") : "—");
const ymd = (s?: string | null): string => (s ? s.slice(0, 10) : "");

// 한 문항 값을 사람이 읽을 문자열로.
function renderVal(q: SurveyQuestion, v: unknown): string {
  if (q.type === "multi") return M(v);
  if (q.type === "consent") return v === true ? "✓ 동의" : v === false ? "미동의" : "—";
  return A(v);
}

// 한 설문의 '모든' 문항 + 예정에 없던 추가 응답까지 빠짐없이 렌더.
function AnswerRows({ kind, answers }: { kind: string; answers: Record<string, unknown> }) {
  const qs = questionsForKind(kind);
  const known = new Set(qs.map((q) => q.key));
  const extraKeys = Object.keys(answers).filter(
    (k) => !known.has(k) && answers[k] != null && (!Array.isArray(answers[k]) || (answers[k] as unknown[]).length > 0),
  );
  return (
    <div className="kv">
      {qs.map((q) => (
        <span key={q.key} style={{ display: "contents" }}>
          <dt>
            {q.label.replace(/\(.*\)$/, "")}
            {!q.optional && <span style={{ color: "var(--ink3)", fontWeight: 400 }}> ·필수</span>}
          </dt>
          <dd>{renderVal(q, answers[q.key])}</dd>
        </span>
      ))}
      {extraKeys.map((k) => (
        <span key={k} style={{ display: "contents" }}>
          <dt style={{ color: "var(--ink3)" }}>{k}</dt>
          <dd>{Array.isArray(answers[k]) ? M(answers[k]) : A(answers[k])}</dd>
        </span>
      ))}
    </div>
  );
}

// 응답 완료된 단일 설문 블록(세부내용 + 필수 누락 경고).
function SurveyDetail({ s }: { s: SurveyLite }) {
  const kind = s.kind ?? "";
  const missing = missingRequired(questionsForKind(kind), s.answers ?? {});
  return (
    <div>
      {missing.length > 0 && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>
          ⚠️ 필수 항목 {missing.length}개 미응답: {missing.map((q) => q.label.replace(/\(.*\)$/, "")).join(", ")} — <b>재설문</b>을 보내 보완하세요.
        </div>
      )}
      <AnswerRows kind={kind} answers={s.answers ?? {}} />
    </div>
  );
}

export default function Brand360SurveyCard({
  brandId,
  surveys,
  state,
}: {
  brandId: string;
  surveys: SurveyLite[];
  state?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [showAll, setShowAll] = useState(false);

  const list = surveys ?? [];
  const primary = list[0] ?? null; // 최신 설문 — 헤더 액션의 기준
  const answered = Boolean(primary?.responded_at);
  const anyAnswered = list.some((s) => s.responded_at);
  const isPre = primary?.kind === "pre_meeting";
  const kindLabel = surveyKindLabel(primary?.kind);

  // 회의 확정: 설문은 1:1 미팅 단계에서(제안서 발송 전) 반드시 나가야 함.
  const preProposalStages = ["meeting", "contact", "contract_review"];
  const needSurvey = !!state && preProposalStages.includes(state) && !anyAnswered;

  // 응답 완료된 설문(세부내용 열람 대상) — 최신순.
  const answeredSurveys = list.filter((s) => s.responded_at);
  const visibleAnswered = showAll ? answeredSurveys : answeredSurveys.slice(0, 1);
  // 아직 응답 대기/미발송인 설문(참고용).
  const pendingSurveys = list.filter((s) => !s.responded_at);

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
          <span className="chip grn">{kindLabel} 응답 완료 {primary!.responded_at!.slice(5, 10).replace("-", "/")}</span>
        ) : primary ? (
          <span className="chip amb">{kindLabel} 응답 대기</span>
        ) : (
          <span className="chip">미발송</span>
        )}
        {list.length > 1 && <span className="chip" style={{ marginLeft: 4 }}>총 {list.length}건</span>}
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
                  if (primary && !isPre) {
                    setUrl(`/s/${primary.token}`);
                    return;
                  }
                  const r = await createSurveyAction(brandId);
                  if (r.ok && r.url) { setUrl(r.url); setMsg("미팅 후 설문 링크 생성됨"); }
                  else setMsg(r.error ?? "실패");
                  router.refresh();
                })
              }
            >
              {primary && !isPre ? "링크 보기" : "+ 미팅 후 설문"}
            </button>
          )}
        </div>
      </div>
      <div className="bd">
        {needSurvey && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#c2410c", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>
            ⚠️ 1:1 미팅·제안서 발송 전 <b>사전 설문</b>을 먼저 보내주세요. (미응답 상태)
          </div>
        )}

        {/* 응답 완료 설문 — 모든 문항 세부내용 */}
        {visibleAnswered.map((s, i) => (
          <div key={s.id ?? s.token} style={{ marginBottom: i < visibleAnswered.length - 1 ? 14 : 0, paddingBottom: i < visibleAnswered.length - 1 ? 14 : 0, borderBottom: i < visibleAnswered.length - 1 ? "1px solid var(--line)" : undefined }}>
            {(answeredSurveys.length > 1 || pendingSurveys.length > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12.5, fontWeight: 700 }}>
                <span className="chip grn">{surveyKindLabel(s.kind)}</span>
                <span style={{ color: "var(--ink3)", fontWeight: 400 }}>응답 {ymd(s.responded_at)}</span>
              </div>
            )}
            <SurveyDetail s={s} />
          </div>
        ))}

        {/* 응답 완료 설문이 2건 이상이면 이력 펼치기 */}
        {answeredSurveys.length > 1 && (
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "최근 1건만 보기" : `이전 설문 이력 ${answeredSurveys.length - 1}건 더 보기`}
          </button>
        )}

        {answered && isPre && (
          <p className="note" style={{ marginTop: 8 }}>
            1:1 미팅 사전학습용 — 회사정보(사업자번호·회사명·주소)는 비어 있는 값에 한해 원장(brands·brand_company)에 자동 반영됩니다.
          </p>
        )}

        {/* 응답 대기/미발송 설문 상태 */}
        {answeredSurveys.length === 0 && pendingSurveys.length > 0 && (
          <p className="note">
            {surveyKindLabel(pendingSurveys[0].kind)} 발송됨({pendingSurveys[0].sent_at ? ymd(pendingSurveys[0].sent_at) : "발송일 미기록"}) — 응답 대기 중입니다.
          </p>
        )}
        {answeredSurveys.length > 0 && pendingSurveys.length > 0 && (
          <p className="note" style={{ marginTop: 8 }}>
            응답 대기 중 설문 {pendingSurveys.length}건 — {pendingSurveys.map((s) => surveyKindLabel(s.kind)).join(", ")}
          </p>
        )}
        {list.length === 0 && (
          <p className="note">
            설문이 아직 없습니다 — 1:1 미팅 전이라면 &apos;사전 설문 보내기&apos;로 링크 생성 + 요청 메일 초안(초안함)을 만드세요.
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
