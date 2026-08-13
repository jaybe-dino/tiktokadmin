"use client";

// v3.1 브랜드360 설문 — ① 개요 카드(상태·발송·요약·탭 이동) ② '설문' 탭 패널(전체 응답 상세).
//   · 사전 설문(pre_meeting) / 미팅 후 설문(post_meeting)
//   · 문항 라벨은 DB 문항뱅크(questionSets)를 우선 사용 → 원본 키(a4_certs 등) 노출 방지.
//   · 라벨/값 2열 레이아웃(라벨 열 폭 제한 + 값 줄바꿈) — 글자 겹침 없음.
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

export interface SurveyLite {
  id?: string;
  token: string;
  kind?: string; // pre_meeting|post_meeting(기본)
  sent_at: string | null;
  responded_at: string | null;
  created_at?: string;
  answers: Record<string, unknown>;
}

// kind → 문항 목록(DB 라벨). 없으면 상수 폴백.
export type QuestionSets = Record<string, SurveyQuestion[]>;

const A = (v: unknown): string => (typeof v === "string" && v.trim() ? v : "—");
const M = (v: unknown): string => (Array.isArray(v) && v.length > 0 ? (v as string[]).join(", ") : "—");
const ymd = (s?: string | null): string => (s ? s.slice(0, 10) : "");
const hasVal = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : v != null && v !== false;

function renderVal(type: SurveyQuestion["type"], v: unknown): string {
  if (type === "multi") return M(v);
  if (type === "consent") return v === true ? "✓ 동의" : v === false ? "미동의" : "—";
  return A(v);
}

// 문항 세트 결정 — DB(questionSets) 우선, 없으면 상수.
function questionsFor(kind: string, sets?: QuestionSets): SurveyQuestion[] {
  const fromDb = sets?.[kind];
  if (fromDb && fromDb.length > 0) return fromDb;
  return questionsForKind(kind);
}

const labelStyle: React.CSSProperties = { color: "var(--ink3)", fontSize: 12.5, wordBreak: "keep-all", lineHeight: 1.5 };
const valueStyle: React.CSSProperties = { fontSize: 13, lineHeight: 1.5, overflowWrap: "anywhere", whiteSpace: "pre-wrap" };
const sectionHd: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: ".03em", color: "var(--acc, #c0326a)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 8 };

// 라벨/값 한 줄 — 라벨 열 폭 제한 + 값 줄바꿈(겹침 방지).
function Row({ label, value, required }: { label: string; value: string; required?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr", gap: 12, alignItems: "start" }}>
      <div style={labelStyle}>
        {label}
        {required && <span style={{ opacity: 0.55 }}> ·필수</span>}
      </div>
      <div style={valueStyle}>{value}</div>
    </div>
  );
}

// 한 설문의 전체 응답 — 섹션별 그룹 + 정의 밖 응답은 '기타'.
function DetailRows({ questions, answers }: { questions: SurveyQuestion[]; answers: Record<string, unknown> }) {
  const sections: string[] = [];
  for (const q of questions) { const s = q.section ?? ""; if (!sections.includes(s)) sections.push(s); }
  const known = new Set(questions.map((q) => q.key));
  const extras = Object.keys(answers).filter((k) => !known.has(k) && hasVal(answers[k]));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {sections.map((sec) => {
        const qs = questions.filter((q) => (q.section ?? "") === sec);
        return (
          <div key={sec || "_"}>
            {sec && <div style={sectionHd}>{sec}</div>}
            <div style={{ display: "grid", gap: 8 }}>
              {qs.map((q) => (
                <Row key={q.key} label={q.label.replace(/\(.*\)$/, "")} value={renderVal(q.type, answers[q.key])} required={!q.optional} />
              ))}
            </div>
          </div>
        );
      })}
      {extras.length > 0 && (
        <div>
          <div style={sectionHd}>기타 응답</div>
          <div style={{ display: "grid", gap: 8 }}>
            {extras.map((k) => (
              <Row key={k} label={k} value={Array.isArray(answers[k]) ? M(answers[k]) : A(answers[k])} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function jumpToSurveyTab() {
  window.dispatchEvent(new CustomEvent("b360:tab", { detail: "sv" }));
}

// 공개 설문 링크(/s/{token}) 복사 버튼 — 재권유·재발송용. 언제든 복사 가능.
function CopyLinkButton({ token, label = "🔗 설문 링크 복사" }: { token: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/s/${token}`;
    const finish = () => { setDone(true); setTimeout(() => setDone(false), 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(finish).catch(finish);
    else {
      // 클립보드 API 미지원 폴백.
      const ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta); finish();
    }
  };
  return (
    <button className="btn sm" onClick={copy} title="공개 설문 링크 복사(재권유·재발송용)">
      {done ? "✓ 복사됨" : label}
    </button>
  );
}

// ── 개요 카드(슬림) — 상태·발송·요약 + 설문 탭 이동 ──────────────
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

  const list = surveys ?? [];
  const primary = list[0] ?? null;
  const answered = Boolean(primary?.responded_at);
  const anyAnswered = list.some((s) => s.responded_at);
  const isPre = primary?.kind === "pre_meeting";
  const kindLabel = surveyKindLabel(primary?.kind);

  const preProposalStages = ["meeting", "contact", "contract_review"];
  const needSurvey = !!state && preProposalStages.includes(state) && !anyAnswered;

  const answeredCount = list.filter((s) => s.responded_at).length;
  const missingAnswered = primary?.responded_at
    ? missingRequired(questionsForKind(primary.kind ?? ""), primary.answers ?? {})
    : [];

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
        <div className="rt" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {primary && <CopyLinkButton token={primary.token} />}
          {!(isPre && answered) && (
            <button className="btn sm" disabled={pending} onClick={sendPre}>사전 설문 보내기</button>
          )}
          {!answered && (
            <button
              className="btn sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (primary && !isPre) { setUrl(`/s/${primary.token}`); return; }
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
        {missingAnswered.length > 0 && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>
            ⚠️ 필수 항목 {missingAnswered.length}개 미응답: {missingAnswered.map((q) => q.label.replace(/\(.*\)$/, "")).join(", ")} — <b>재설문</b> 권장.
          </div>
        )}

        {answeredCount > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="chip grn">응답 {answeredCount}건</span>
            {primary?.responded_at && <span className="note" style={{ margin: 0 }}>최근 {ymd(primary.responded_at)}</span>}
            <button className="btn sm" style={{ marginLeft: "auto" }} onClick={jumpToSurveyTab}>📋 설문 응답 전체 보기 →</button>
          </div>
        ) : primary ? (
          <p className="note">
            {kindLabel} 발송됨({primary.sent_at ? ymd(primary.sent_at) : "발송일 미기록"}) — 응답 대기 중입니다.
          </p>
        ) : (
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

// ── '설문' 탭 패널 — 전체 응답 상세(섹션별·겹침 없음) ──────────────
export function Brand360SurveyPanel({
  surveys,
  questionSets,
}: {
  surveys: SurveyLite[];
  questionSets?: QuestionSets;
}) {
  const list = surveys ?? [];
  const answeredSurveys = list.filter((s) => s.responded_at);
  const pendingSurveys = list.filter((s) => !s.responded_at);

  if (list.length === 0) {
    return (
      <div className="card">
        <div className="bd">
          <p className="note">설문이 아직 없습니다 — 개요 탭에서 &apos;사전 설문 보내기&apos;로 발송하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {answeredSurveys.map((s) => {
        const kind = s.kind ?? "";
        const qs = questionsFor(kind, questionSets);
        const missing = missingRequired(questionsForKind(kind), s.answers ?? {});
        return (
          <div className="card" key={s.id ?? s.token}>
            <div className="hd">
              <b>{surveyKindLabel(kind)}</b>
              <span className="chip grn">응답 완료 {ymd(s.responded_at)}</span>
              <span className="rt"><CopyLinkButton token={s.token} label="🔗 링크 복사(재권유)" /></span>
            </div>
            <div className="bd">
              {missing.length > 0 && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>
                  ⚠️ 필수 항목 {missing.length}개 미응답: {missing.map((q) => q.label.replace(/\(.*\)$/, "")).join(", ")} — 재설문 권장.
                </div>
              )}
              <DetailRows questions={qs} answers={s.answers ?? {}} />
            </div>
          </div>
        );
      })}

      {pendingSurveys.length > 0 && (
        <div className="card">
          <div className="hd"><b>응답 대기 중 설문 {pendingSurveys.length}건</b></div>
          <div className="bd" style={{ display: "grid", gap: 8 }}>
            {pendingSurveys.map((s) => (
              <div key={s.id ?? s.token} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="chip amb">{surveyKindLabel(s.kind)}</span>
                <span className="note" style={{ margin: 0 }}>발송 {s.sent_at ? ymd(s.sent_at) : "미기록"}</span>
                <span style={{ marginLeft: "auto" }}><CopyLinkButton token={s.token} label="🔗 링크 복사(재권유)" /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="note" style={{ margin: "0 2px" }}>
        1:1 미팅 사전학습용 — 회사정보(사업자번호·회사명·주소)는 비어 있는 값에 한해 원장(brands·brand_company)에 자동 반영됩니다.
      </p>
    </div>
  );
}
