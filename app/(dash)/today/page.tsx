import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { GradeBadge } from "@/components/badges";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { listDrafts } from "@/lib/drafts";
import { allApprovals } from "@/lib/repo/global";
import { findDuplicateGroups } from "@/lib/repo/queries";
import type { Grade } from "@/lib/types";
import { AcceptLeadButton, ApproveSendButton, DiscardDraftButton } from "./TodayButtons";
import { onboardingPipeline, ONB_STAGES } from "@/lib/onboarding-pipeline";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

function fmtTime(v: unknown): string {
  if (!v) return "";
  try { return new Date(v as string).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; }
}
function fmtDateTime(v: unknown): string {
  if (!v) return "—";
  try { return new Date(v as string).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return "—"; }
}
async function count(sql: string): Promise<number> {
  const r = await queryOne<{ c: string }>(sql).catch(() => null);
  return num(r?.c);
}

// 영업 파이프라인 단계(브랜드 state 기반) — v3.1 s-home 퍼널 현황.
const FUNNEL: { states: string[]; label: string; cls: string }[] = [
  { states: ["lead_new"], label: "리드", cls: "st-lead" },
  { states: ["seminar"], label: "담당자배정", cls: "st-sem" },
  { states: ["meeting"], label: "미팅", cls: "st-meet" },
  { states: ["contact"], label: "컨택", cls: "st-cont" },
  { states: ["contract_review"], label: "계약검토", cls: "st-crev" },
  { states: ["contract_done"], label: "계약완료", cls: "st-cdone" },
  { states: ["docs"], label: "서류", cls: "st-docs" },
  { states: ["setup"], label: "셋업", cls: "st-setup" },
  { states: ["live_mall", "live_onboarding"], label: "운영", cls: "st-live" },
  { states: ["settling"], label: "정산", cls: "st-set" },
];

// 마케팅 파이프라인 단계(mkt_projects.proposal_status) — MktScreen PIPE 와 동일.
const MKT_PIPE: { key: string; label: string }[] = [
  { key: "draft", label: "제안작성" },
  { key: "sent", label: "발송·협의" },
  { key: "negotiating", label: "협의중" },
  { key: "won", label: "수주" },
  { key: "dropped", label: "완료·드랍" },
];

const AGENT_LABEL: Record<string, string> = {
  daily_ops_check: "일일 운영 점검", doc_reminder: "서류 리마인더", pay_watch: "결제·정산 감시",
  cert_watch: "인증 만료 감시", cycle_watch: "사이클 감시", no_reply_watch: "무응답 감시",
  meeting_followup: "미팅 후처리", weekly_insight: "주간 자가학습", pre_analysis: "사전분석",
  inbound_reply: "인바운드 자동 회신",
};

// 초안 kind → 승인 대기 행 표시 (아이콘 · 제목 라벨)
const DRAFT_ROW: Record<string, { icon: string; ico: string; label: string }> = {
  followup: { icon: "🎙️", ico: "i-pur", label: "팔로업 메일 초안" },
  reply: { icon: "✉️", ico: "i-pur", label: "회신 초안" },
  reply_transactional: { icon: "✉️", ico: "i-pur", label: "자동 회신 초안" },
  reminder: { icon: "⏰", ico: "i-amb", label: "서류 리마인더" },
  doc_request: { icon: "⏰", ico: "i-amb", label: "서류 요청" },
  payment_notice: { icon: "💳", ico: "i-red", label: "결제 안내" },
  settlement: { icon: "💳", ico: "i-red", label: "정산 안내" },
};

const APPROVAL_KO: Record<string, string> = { drop: "드랍", refund: "환불", settlement: "정산 확정" };

function approvalReason(payload: Row): string {
  const r = payload.reason ?? payload.note ?? payload.memo;
  if (r) return String(r);
  const s = Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join(" · ");
  return s || "—";
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const todayLabel = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const user = await currentUser();

  // 기획 확정: [내 담당만 ↔ 전체] 토글 (기본=내 담당만, 담당 브랜드 없으면 전체)
  const sp = await searchParams;
  const myBrandIds = new Set(
    (await query<{ id: string }>(
      `SELECT id FROM brands WHERE $1 IN (owner_intake, owner_sales, owner_onboard, owner_ads)`,
      [user?.id ?? ""]).catch(() => [])).map((r) => r.id));
  const mine = sp.scope === "all" ? false : sp.scope === "mine" ? true : myBrandIds.size > 0;

  // ── 상단 타일·헤더 카운트: 13회 DB 왕복 → 1회 통합(FILTER) — 로딩 근본 개선 ─
  const kpi = await queryOne<Record<string, string>>(`SELECT
    (SELECT count(*) FROM brands WHERE coalesce(is_test,false)=false) total,
    (SELECT count(*) FROM brands WHERE coalesce(is_test,false)=false AND state IN ('live_mall','live_onboarding','settling')) operating,
    (SELECT count(*) FROM brands WHERE coalesce(is_test,false)=false AND state='live_mall') oper_mall,
    (SELECT count(*) FROM brands WHERE coalesce(is_test,false)=false AND state='live_onboarding') oper_onb,
    (SELECT count(*) FROM brands WHERE coalesce(is_test,false)=false AND created_at > now()-interval '7 days') week_new,
    (SELECT count(*) FROM brands WHERE coalesce(is_test,false)=false AND created_at > now()-interval '24 hours') new_24h,
    (SELECT count(*) FROM alerts a JOIN brands b ON b.id=a.brand_id WHERE a.kind='sla_breach' AND a.resolved_at IS NULL AND coalesce(b.is_test,false)=false) sla,
    (SELECT count(*) FROM alerts a JOIN brands b ON b.id=a.brand_id WHERE a.kind='sla_breach' AND a.resolved_at IS NULL AND a.tier>=2 AND coalesce(b.is_test,false)=false) sla_t2,
    (SELECT count(*) FILTER (WHERE to_state='seminar' AND at > now()-interval '7 days') FROM stage_history WHERE at > now()-interval '28 days') sem_w,
    (SELECT count(*) FILTER (WHERE to_state='meeting' AND at > now()-interval '7 days') FROM stage_history WHERE at > now()-interval '28 days') meet_w,
    (SELECT count(*) FILTER (WHERE to_state='seminar') FROM stage_history WHERE at > now()-interval '28 days') sem_4w,
    (SELECT count(*) FILTER (WHERE to_state='meeting') FROM stage_history WHERE at > now()-interval '28 days') meet_4w,
    (SELECT count(*) FROM meetings WHERE summary_md IS NOT NULL AND created_at > now()-interval '24 hours') recaps_24h
  `).catch(() => null);
  const kpiFailed = kpi === null; // 통합 지표 쿼리 실패 — 타일이 0 으로 위장되지 않게 배지로 노출(pipeline#2)
  const k = (key: string) => num(kpi?.[key]);
  const totalBrands = k("total"), operating = k("operating"), operMall = k("oper_mall"), operOnb = k("oper_onb");
  const slaBreach = k("sla"), slaT2 = k("sla_t2"), weekNew = k("week_new");
  const semWeek = k("sem_w"), meetWeek = k("meet_w"), sem4w = k("sem_4w"), meet4w = k("meet_4w");
  const newLeads24h = k("new_24h"), recaps24h = k("recaps_24h");
  const convPct = semWeek > 0 ? Math.round((meetWeek / semWeek) * 100) : 0;
  const conv4wPct = sem4w > 0 ? Math.round((meet4w / sem4w) * 100) : 0;
  const convDiff = convPct - conv4wPct;

  // ── 서로 독립인 조회들을 한 번에 병렬 실행(직렬 왕복 제거 — 홈 로딩 근본 개선) ─
  const [dupCount, funnelRows, draftsAll, approvalsAllRaw, meetingsAll, agentRuns, lead, onbPipe, mktStatusRows] = await Promise.all([
    findDuplicateGroups().then((g) => g.length).catch(() => 0),
    query<{ state: string; c: string }>(
      "SELECT state, count(*) c FROM brands WHERE coalesce(is_test,false)=false GROUP BY state").catch(() => []),
    listDrafts("draft").catch(() => []),
    allApprovals().catch(() => []) as Promise<Row[]>,
    query(
      `SELECT m.id, m.topic, m.scheduled_at, m.host_email, m.brand_id, b.brand_name, b.grade
         FROM meetings m LEFT JOIN brands b ON b.id=m.brand_id
        WHERE m.scheduled_at::date = CURRENT_DATE AND coalesce(m.status,'') NOT IN ('canceled','error')
        ORDER BY m.scheduled_at ASC LIMIT 8`).catch(() => []) as Promise<Row[]>,
    query(
      `SELECT agent, status, summary, actions, started_at FROM agent_runs
        WHERE started_at > now()-interval '24 hours' ORDER BY started_at DESC LIMIT 5`).catch(() => []) as Promise<Row[]>,
    queryOne<Row>(
      `SELECT id, brand_name, grade, source, category, created_at FROM brands
        WHERE coalesce(is_test,false)=false ORDER BY created_at DESC NULLS LAST LIMIT 1`).catch(() => null),
    onboardingPipeline().catch(() => ({ invite: [], company: [], signup: [], product: [], ready: [] })),
    query<{ proposal_status: string; c: string }>(
      "SELECT proposal_status, count(*) c FROM mkt_projects GROUP BY proposal_status").catch(() => []),
  ]);

  // ── 퍼널 현황 (영업·온보딩·마케팅 3개 파이프라인) ───────────────
  const funnelMap = new Map(funnelRows.map((r) => [r.state, num(r.c)]));
  const funnel = FUNNEL.map((f) => ({ ...f, n: f.states.reduce((s, st) => s + (funnelMap.get(st) ?? 0), 0) }));
  // 온보딩 파이프라인 — onboardingPipeline() 단계별 카드 수
  const onbFunnel = ONB_STAGES.map((s) => ({ key: s.key, label: s.label, n: (onbPipe[s.key] ?? []).length }));
  const onbTotal = onbFunnel.reduce((s, f) => s + f.n, 0);
  // 마케팅 파이프라인 — mkt_projects.proposal_status 별 수
  const mktMap = new Map(mktStatusRows.map((r) => [r.proposal_status, num(r.c)]));
  const mktFunnel = MKT_PIPE.map((p) => ({ ...p, n: mktMap.get(p.key) ?? 0 }));
  const mktTotal = mktFunnel.reduce((s, f) => s + f.n, 0);
  const salesTotal = funnel.reduce((s, f) => s + f.n, 0);

  // ── 승인 대기 — AI가 준비해둔 것 (초안 + 결재 요청, scope 반영) ─
  const approvalsAll = approvalsAllRaw.filter((a) => a.status === "pending");
  const drafts = mine ? draftsAll.filter((d) => myBrandIds.has(d.brand_id)) : draftsAll;
  const approvals = mine ? approvalsAll.filter((a) => !a.brand_id || myBrandIds.has(a.brand_id as string)) : approvalsAll;
  const pendingTotal = drafts.length + approvals.length;
  const draftRows = drafts.slice(0, 4);
  const approvalRows = approvals.slice(0, 3);

  // ── 오늘 미팅 (scope 반영) ────────────────────────────────────
  const meetings = mine
    ? meetingsAll.filter((m) => (m.brand_id && myBrandIds.has(m.brand_id as string)) || m.host_email === user?.id)
    : meetingsAll;

  return (
    <div>
      <ScreenHeader
        title={`오늘 — ${todayLabel}`}
        desc={`${user?.name ?? "운영자"}님, 밤 사이 신규 리드 ${newLeads24h}건 · 줌 회의록 ${recaps24h}건이 자동 처리됐어요. 승인 대기 ${pendingTotal}건부터 확인하세요.`}
        right={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* 기획 확정: 내 담당만 ↔ 전체 토글 (승인대기·오늘미팅에 적용) */}
          <span style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <Link href="/today?scope=mine" className="btn sm" style={{ border: "none", borderRadius: 0, ...(mine ? { background: "var(--acc)", color: "#fff" } : {}) }}>내 담당만</Link>
            <Link href="/today?scope=all" className="btn sm" style={{ border: "none", borderRadius: 0, ...(!mine ? { background: "var(--acc)", color: "#fff" } : {}) }}>전체</Link>
          </span>
          {kpiFailed && <span className="chip" style={{ background: "#fee2e2", color: "#b91c1c" }}>지표 로드 실패</span>}
          <Link href="/monitor" className="btn">SLA 모니터</Link>
          <Link href="/import" className="btn pri">+ 리드 등록</Link>
        </div>}
      />

      {/* 상단 4개 타일 */}
      <div className="grid g4 gap-3.5 mb-3.5" style={{ display: "grid" }}>
        <div className="tile"><div className="k">전체 브랜드 (원장)</div><div className="v">{totalBrands}</div><div className="d up">▲ 이번 주 +{weekNew} · 중복 {dupCount}</div></div>
        <div className="tile"><div className="k">운영 중 (멀티몰+온보딩)</div><div className="v">{operating}</div><div className="d">멀티몰 {operMall} · 온보딩 {operOnb}</div></div>
        <div className={`tile${slaBreach > 0 ? " alert" : ""}`}><div className="k">SLA 위반</div><div className="v" style={{ color: slaBreach > 0 ? "var(--danger)" : undefined }}>{slaBreach}</div><div className={`d ${slaT2 > 0 ? "dn" : ""}`}>{slaT2 > 0 ? `T2+ ${slaT2}건 — 파트장 확인 필요` : "이상 없음"}</div></div>
        <div className="tile" title="같은 코호트 추적이 아니라 이번 주 담당자배정 전이수 대비 미팅 전이수 비율입니다."><div className="k">주간 담당자배정·미팅 비율</div><div className="v">{convPct}<small>%</small></div><div className={`d ${convDiff >= 0 ? "up" : "dn"}`}>{convDiff >= 0 ? "▲" : "▼"} 4주 평균 {conv4wPct}% 대비 {convDiff >= 0 ? "+" : ""}{convDiff}%p</div></div>
      </div>

      <div className="grid g31 gap-3.5" style={{ display: "grid" }}>
        {/* 좌측 */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* 퍼널 현황 — 영업 · 온보딩 · 마케팅 3개 파이프라인 */}
          <div className="card">
            <div className="hd"><b>퍼널 현황</b><span style={{ color: "var(--ink3)", fontSize: 11.5 }}>파이프라인별 단계 수</span></div>
            <div className="bd" style={{ display: "grid", gap: 12 }}>
              {/* 영업 파이프라인 */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <b style={{ fontSize: 12.5 }}>📋 영업 파이프라인</b>
                  <span className="chip">{salesTotal}</span>
                  <Link href="/" className="btn sm" style={{ marginLeft: "auto" }}>보드 →</Link>
                </div>
                <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                  {funnel.map((f) => (
                    <div key={f.label} style={{ textAlign: "center", minWidth: 68 }}>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{f.n}</div>
                      <span className={`bdg ${f.cls}`}>{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 온보딩 파이프라인 */}
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <b style={{ fontSize: 12.5 }}>🚚 온보딩 파이프라인</b>
                  <span className="chip">{onbTotal}</span>
                  <Link href="/onboarding-pipeline" className="btn sm" style={{ marginLeft: "auto" }}>보드 →</Link>
                </div>
                <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                  {onbFunnel.map((f) => (
                    <div key={f.key} style={{ textAlign: "center", minWidth: 84 }}>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{f.n}</div>
                      <span className="bdg" style={{ background: "var(--onb-bg,#ecfeff)", color: "var(--onb,#0891b2)" }}>{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 마케팅 파이프라인 */}
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <b style={{ fontSize: 12.5 }}>📣 마케팅 파이프라인</b>
                  <span className="chip">{mktTotal}</span>
                  <Link href="/mkt" className="btn sm" style={{ marginLeft: "auto" }}>보드 →</Link>
                </div>
                <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                  {mktFunnel.map((f) => (
                    <div key={f.key} style={{ textAlign: "center", minWidth: 72 }}>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{f.n}</div>
                      <span className="bdg" style={{ background: "var(--mkt-bg,#fdf4ff)", color: "var(--mkt,#a21caf)" }}>{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 승인 대기 — AI가 준비해둔 것 */}
          <div className="card">
            <div className="hd"><b>승인 대기 — AI가 준비해둔 것</b><span className="chip amb">{pendingTotal}건</span></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              {pendingTotal === 0 && <p style={{ color: "var(--ink3)", fontSize: 12.5 }}>승인 대기 항목이 없습니다.</p>}
              {draftRows.map((d) => {
                const meta = d.meeting_id
                  ? { icon: "🎙️", ico: "i-pur", label: "줌 회의록 + 팔로업 메일 초안" }
                  : DRAFT_ROW[d.kind] ?? { icon: "✉️", ico: "i-pur", label: "메일 초안" };
                return (
                  <div className="row" key={d.id}>
                    <span className={`ico ${meta.ico}`}>{meta.icon}</span>
                    <div>
                      <div className="tt">{d.brand_name} · {meta.label}</div>
                      <div className="ss">{d.subject || "제목 없음"}{d.to_email ? ` · → ${d.to_email}` : " · 수신 이메일 없음 — 채우기 전 발송 불가"}</div>
                    </div>
                    <div className="rt" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Link href="/drafts" className="btn sm">미리보기</Link>
                      {d.to_email
                        ? <ApproveSendButton id={d.id} />
                        : <Link href="/drafts" className="btn sm dgr">답변 필요</Link>}
                      <DiscardDraftButton id={d.id} />
                    </div>
                  </div>
                );
              })}
              {approvalRows.map((a) => (
                <div className="row" key={a.id as string}>
                  <span className="ico i-blu">👤</span>
                  <div>
                    <div className="tt">
                      {a.brand_id
                        ? <Link href={`/brand/${a.brand_id}`} className="hover:underline">{(a.brand_name as string) || "브랜드"}</Link>
                        : "브랜드 무관"}
                      {" · "}{APPROVAL_KO[a.kind as string] ?? (a.kind as string)} 결재 요청
                    </div>
                    <div className="ss">요청자 {(a.requested_by as string) || "—"} · {approvalReason((a.payload as Row) ?? {})}</div>
                  </div>
                  <div className="rt" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {/* 기획 확정: 결재(드랍·환불·정산확정)는 홈에서 원클릭 금지 — 결재함에서 처리 */}
                    <Link href="/approvals" className="btn sm pri">결재함에서 처리 →</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 우측 */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {/* 오늘 미팅 */}
          <div className="card">
            <div className="hd"><b>오늘 미팅 {meetings.length}건</b><div className="rt"><Link href="/meetings" className="btn sm">캘린더 →</Link></div></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              {meetings.length === 0 && <p style={{ color: "var(--ink3)", fontSize: 12.5 }}>오늘 예정된 미팅이 없습니다.</p>}
              {meetings.map((m) => (
                <div className="row" key={m.id as string}>
                  <span className="ico i-blu">📹</span>
                  <div>
                    <div className="tt">{fmtTime(m.scheduled_at)} {m.brand_id ? <Link href={`/brand/${m.brand_id}`} className="hover:underline">{(m.brand_name as string) || "브랜드"}</Link> : (m.brand_name as string) || "미매칭"} {m.grade ? <GradeBadge grade={m.grade as Grade} /> : null}</div>
                    <div className="ss">{(m.topic as string) || "주제 미정"}{m.host_email ? ` · ${m.host_email}` : ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 에이전트 활동 24h */}
          <div className="card">
            <div className="hd"><b>에이전트 활동 (지난 24h)</b></div>
            <div className="bd" style={{ paddingTop: 6, fontSize: 12 }}>
              {agentRuns.length === 0 && <p style={{ color: "var(--ink3)", fontSize: 12.5 }}>최근 24시간 에이전트 실행 기록이 없습니다.</p>}
              {agentRuns.map((r, i) => (
                <div className="row" key={i}>
                  <span className={`ico ${r.status === "error" ? "i-red" : r.status === "ok" ? "i-grn" : "i-amb"}`}>{r.status === "error" ? "🚨" : "✅"}</span>
                  <div>
                    <div className="tt">{AGENT_LABEL[r.agent as string] ?? (r.agent as string)} {num(r.actions) > 0 ? `· 조치 ${num(r.actions)}` : ""}</div>
                    <div className="ss">{(r.summary as string) || r.status as string} · {fmtDateTime(r.started_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Slack 유입알림 */}
          {lead && (
            <div className="slk">
              <b style={{ color: "#611f69" }}>#glovek-유입알림</b> <span style={{ color: "var(--ink3)", fontSize: 11 }}>{fmtDateTime(lead.created_at)}</span><br />
              🆕 <b>{lead.brand_name as string}</b> · {(lead.source as string) || "유입"} 리드 · 등급 <b>{(lead.grade as string) || "미정"}</b><br />
              <span style={{ color: "var(--ink3)", fontSize: 11.5 }}>{(lead.category as string) || "카테고리 미상"}</span><br />
              <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <AcceptLeadButton brandId={lead.id as string} />
                <Link href={`/brand/${lead.id}`} className="btn sm">브리프 보기</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
