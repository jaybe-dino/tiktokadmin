import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { GradeBadge } from "@/components/badges";
import { query, queryOne } from "@/lib/db";
import type { Grade } from "@/lib/types";

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

// 퍼널 단계 → 표시(짧은 이름·배지 클래스)
const FUNNEL: { states: string[]; label: string; cls: string }[] = [
  { states: ["lead_new"], label: "리드", cls: "st-lead" },
  { states: ["seminar"], label: "세미나", cls: "st-sem" },
  { states: ["meeting"], label: "미팅", cls: "st-meet" },
  { states: ["contact"], label: "컨택", cls: "st-cont" },
  { states: ["contract_review"], label: "계약검토", cls: "st-crev" },
  { states: ["contract_done"], label: "계약완료", cls: "st-cdone" },
  { states: ["docs"], label: "서류", cls: "st-docs" },
  { states: ["setup"], label: "셋업", cls: "st-setup" },
  { states: ["live_mall", "live_onboarding"], label: "운영", cls: "st-live" },
  { states: ["settling"], label: "정산", cls: "st-set" },
];

const AGENT_LABEL: Record<string, string> = {
  daily_ops_check: "일일 운영 점검", doc_reminder: "서류 리마인더", pay_watch: "결제·정산 감시",
  cert_watch: "인증 만료 감시", cycle_watch: "사이클 감시", no_reply_watch: "무응답 감시",
  meeting_followup: "미팅 후처리", weekly_insight: "주간 자가학습", pre_analysis: "사전분석",
  inbound_reply: "인바운드 자동 회신",
};

export default async function TodayPage() {
  const todayLabel = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });

  // ── 상단 4개 타일 ──────────────────────────────────────────────
  const [totalBrands, operating, slaBreach, weekNew, semWeek, meetWeek] = await Promise.all([
    count("SELECT count(*) c FROM brands WHERE coalesce(is_test,false)=false"),
    count("SELECT count(*) c FROM brands WHERE state IN ('live_mall','live_onboarding','settling') AND coalesce(is_test,false)=false"),
    count("SELECT count(*) c FROM alerts WHERE kind='sla_breach' AND resolved_at IS NULL"),
    count("SELECT count(*) c FROM brands WHERE coalesce(is_test,false)=false AND created_at > now()-interval '7 days'"),
    count("SELECT count(*) c FROM stage_history WHERE to_state='seminar' AND at > now()-interval '7 days'"),
    count("SELECT count(*) c FROM stage_history WHERE to_state='meeting' AND at > now()-interval '7 days'"),
  ]);
  const operMall = await count("SELECT count(*) c FROM brands WHERE state='live_mall' AND coalesce(is_test,false)=false");
  const operOnb = await count("SELECT count(*) c FROM brands WHERE state='live_onboarding' AND coalesce(is_test,false)=false");
  const convPct = semWeek > 0 ? Math.round((meetWeek / semWeek) * 100) : 0;

  // ── 퍼널 현황 ─────────────────────────────────────────────────
  const funnelRows = (await query<{ state: string; c: string }>(
    "SELECT state, count(*) c FROM brands WHERE coalesce(is_test,false)=false GROUP BY state").catch(() => []));
  const funnelMap = new Map(funnelRows.map((r) => [r.state, num(r.c)]));
  const funnel = FUNNEL.map((f) => ({ ...f, n: f.states.reduce((s, st) => s + (funnelMap.get(st) ?? 0), 0) }));

  // ── AI가 체크한 지금 해야 할 일 (실데이터 병합) ─────────────────
  const unassigned = (await query(
    `SELECT id, brand_name, grade, source, created_at FROM brands
      WHERE coalesce(is_test,false)=false AND state NOT IN ('dropped','churned')
        AND owner_intake IS NULL AND owner_sales IS NULL AND owner_onboard IS NULL AND owner_ads IS NULL
      ORDER BY created_at DESC LIMIT 3`).catch(() => [])) as Row[];
  const drafts = (await query(
    `SELECT d.id, d.brand_id, d.kind, d.subject, b.brand_name FROM email_drafts d JOIN brands b ON b.id=d.brand_id
      WHERE d.status='draft' ORDER BY d.created_at DESC LIMIT 4`).catch(() => [])) as Row[];

  type Todo = { icon: string; ico: string; title: string; sub: string; action: string; actionCls: string; href?: string; chip?: string };
  const todos: Todo[] = [];
  for (const u of unassigned) {
    todos.push({ icon: "🆕", ico: "i-amb", title: `${u.brand_name} · 신규 유입 — 담당 수락 대기`, chip: "신규",
      sub: `${(u.source as string) || "유입"} · 등급 ${(u.grade as string) || "미정"} · 수락해야 SLA 타이머가 내 것이 됩니다`,
      action: "담당 수락", actionCls: "pri", href: `/brand/${u.id}` });
  }
  const KIND_KO: Record<string, string> = { reply: "답장", reply_transactional: "자동회신", followup: "팔로업", reminder: "리마인더", payment_notice: "결제안내", doc_request: "서류요청" };
  for (const d of drafts) {
    todos.push({ icon: "✉️", ico: "i-pur", title: `${d.brand_name} · ${KIND_KO[d.kind as string] ?? "메일"} 초안`,
      sub: (d.subject as string) || "초안 검토 후 승인·발송", action: "승인·발송", actionCls: "grn", href: "/drafts" });
  }

  // ── 오늘 미팅 ─────────────────────────────────────────────────
  const meetings = (await query(
    `SELECT m.id, m.topic, m.scheduled_at, m.brand_id, b.brand_name, b.grade
       FROM meetings m LEFT JOIN brands b ON b.id=m.brand_id
      WHERE m.scheduled_at::date = CURRENT_DATE AND coalesce(m.status,'') NOT IN ('canceled','error')
      ORDER BY m.scheduled_at ASC LIMIT 8`).catch(() => [])) as Row[];

  // ── 에이전트 활동 (지난 24h) ──────────────────────────────────
  const agentRuns = (await query(
    `SELECT agent, status, summary, actions, started_at FROM agent_runs
      WHERE started_at > now()-interval '24 hours' ORDER BY started_at DESC LIMIT 5`).catch(() => [])) as Row[];

  // ── 최근 유입 리드 (Slack 유입알림 카드) ──────────────────────
  const lead = (await queryOne<Row>(
    `SELECT id, brand_name, grade, source, category FROM brands
      WHERE coalesce(is_test,false)=false ORDER BY created_at DESC NULLS LAST LIMIT 1`).catch(() => null));

  return (
    <div>
      <ScreenHeader
        title={`오늘 — ${todayLabel}`}
        desc={`신규 유입 ${weekNew}건(7일) · 승인 대기 초안 ${drafts.length}건 · SLA 위반 ${slaBreach}건부터 확인하세요.`}
        right={<div style={{ display: "flex", gap: 8 }}>
          <Link href="/monitor" className="btn">일일 점검 리포트</Link>
          <Link href="/import" className="btn btn-primary">+ 리드 등록</Link>
        </div>}
      />

      {/* 상단 4개 타일 */}
      <div className="grid g4 gap-3.5 mb-3.5" style={{ display: "grid" }}>
        <div className="tile"><div className="k">전체 브랜드 (원장)</div><div className="v">{totalBrands}</div><div className="d up">▲ 이번 주 +{weekNew}</div></div>
        <div className="tile"><div className="k">운영 중 (멀티몰+온보딩)</div><div className="v">{operating}</div><div className="d">멀티몰 {operMall} · 온보딩 {operOnb}</div></div>
        <div className={`tile${slaBreach > 0 ? " alert" : ""}`}><div className="k">SLA 위반</div><div className="v" style={{ color: slaBreach > 0 ? "var(--danger)" : undefined }}>{slaBreach}</div><div className="d dn">미해소 — 파트장 확인 필요</div></div>
        <div className="tile"><div className="k">이번 주 세미나→미팅 전환</div><div className="v">{convPct}<small>%</small></div><div className="d">세미나 {semWeek} · 미팅 {meetWeek}</div></div>
      </div>

      <div className="grid g31 gap-3.5" style={{ display: "grid" }}>
        {/* 좌측 */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {/* 퍼널 현황 */}
          <div className="card">
            <div className="hd"><b>퍼널 현황</b><span style={{ color: "var(--ink3)", fontSize: 11.5 }}>브랜드 수 · 칸반에서 상세</span><div className="rt"><Link href="/" className="btn sm">보드 열기 →</Link></div></div>
            <div className="bd" style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {funnel.map((f) => (
                <div key={f.label} style={{ textAlign: "center", minWidth: 74 }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{f.n}</div>
                  <span className={`bdg ${f.cls}`}>{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI가 체크한 지금 해야 할 일 */}
          <div className="card">
            <div className="hd"><b>AI가 체크한 지금 해야 할 일</b><span className="chip chip-amb">{todos.length}건</span><span style={{ color: "var(--ink3)", fontSize: 11 }}>우선순위 자동 정렬 — 유입·배정이 맨 위</span></div>
            <div className="bd" style={{ paddingTop: 6 }}>
              {todos.length === 0 && <p style={{ color: "var(--ink3)", fontSize: 12.5 }}>처리할 항목이 없습니다.</p>}
              {todos.map((t, i) => (
                <div className="row" key={i}>
                  <span className={`ico ${t.ico}`}>{t.icon}</span>
                  <div>
                    <div className="tt">{t.title} {t.chip && <span className="chip chip-red" style={{ fontSize: 10 }}>{t.chip}</span>}</div>
                    <div className="ss">{t.sub}</div>
                  </div>
                  <div className="rt">{t.href
                    ? <Link href={t.href} className={`btn sm ${t.actionCls}`}>{t.action}</Link>
                    : <button className={`btn sm ${t.actionCls}`}>{t.action}</button>}</div>
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
                    <div className="ss">{(m.topic as string) || "주제 미정"}</div>
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
              <b style={{ color: "#611f69" }}>#glovek-유입알림</b> <span style={{ color: "var(--ink3)", fontSize: 11 }}>최근</span><br />
              🆕 <b>{lead.brand_name as string}</b> · {(lead.source as string) || "유입"} 리드 · 등급 <b>{(lead.grade as string) || "미정"}</b><br />
              <span style={{ color: "var(--ink3)", fontSize: 11.5 }}>{(lead.category as string) || "카테고리 미상"}</span><br />
              <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <Link href={`/brand/${lead.id}`} className="btn sm btn-primary">담당 수락</Link>
                <Link href={`/brand/${lead.id}`} className="btn sm">브리프 보기</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
