// AI 에이전트 레이어 (06) — 업무 효율 극대화용 자동 에이전트 레지스트리 + 실행 엔진.
//   원칙: 읽기=DB 직결, 쓰기(상태변경·발송)=제안/초안까지만(사람 승인). AI는 요약·제안만.
//   키(ANTHROPIC) 없이도 결정론 에이전트는 동작, AI 에이전트는 키 있으면 강화.
import { query, queryOne } from "./db";
import { aiText, aiEnabled } from "./ai";

export type AgentKind = "deterministic" | "ai";
export interface AgentResult { summary: string; actions?: number; detail?: Record<string, unknown> }
export interface AgentDef {
  key: string;
  label: string;
  schedule: string;   // 사람이 읽는 스케줄(크론 등록 참고)
  kind: AgentKind;
  desc: string;
  run: () => Promise<AgentResult>;
}

// ── 개별 에이전트 ──────────────────────────────────────────────

// 1) 일일 운영 점검 — SLA·게이트·서류·미배정 집계
async function dailyOpsCheck(): Promise<AgentResult> {
  const r = await queryOne<Record<string, string>>(`SELECT
    (SELECT count(*) FROM alerts WHERE kind='sla_breach' AND resolved_at IS NULL) sla,
    (SELECT count(*) FROM stage_history WHERE gate_passed=false AND at > now()-interval '7 days') gate,
    (SELECT count(*) FROM brands WHERE state='docs') docs,
    (SELECT count(*) FROM brands WHERE state NOT IN ('dropped','churned')
       AND owner_intake IS NULL AND owner_sales IS NULL AND owner_onboard IS NULL AND owner_ads IS NULL) unassigned,
    (SELECT count(*) FROM brands WHERE state NOT IN ('dropped','churned')
       AND last_contact_at < now()-interval '14 days') stale`).catch(() => null);
  const s = r ?? {};
  const summary = `SLA위반 ${s.sla ?? 0} · 게이트위반(7d) ${s.gate ?? 0} · 서류단계 ${s.docs ?? 0} · 미배정 ${s.unassigned ?? 0} · 접촉공백14d+ ${s.stale ?? 0}`;
  return { summary, actions: 0, detail: s };
}

// 2) 서류 리마인더 — docs 단계 미완 브랜드에 리마인더 초안 생성(없으면)
async function docReminder(): Promise<AgentResult> {
  const brands = await query<{ id: string; brand_name: string; email: string | null }>(
    `SELECT b.id, b.brand_name, b.email FROM brands b
      WHERE b.state='docs' AND EXISTS(SELECT 1 FROM doc_items d WHERE d.brand_id=b.id AND d.done=false)`).catch(() => []);
  let made = 0;
  for (const b of brands) {
    const has = await queryOne<{ id: string }>(
      "SELECT id FROM email_drafts WHERE brand_id=$1 AND kind='reminder' AND status='draft'", [b.id]).catch(() => null);
    if (has) continue;
    await query(
      `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status)
       VALUES ($1,'reminder',$2,$3,$4,'draft')`,
      [b.id, b.email ?? "", `[GloveK] ${b.brand_name} 서류 제출 요청`,
       `${b.brand_name}님, 온보딩 진행을 위해 미제출 서류 확인 부탁드립니다. (초안 — 담당 검토 후 발송)`]).catch(() => {});
    made++;
  }
  return { summary: `서류 미완 ${brands.length}건 · 리마인더 초안 ${made}건 생성(초안함)`, actions: made };
}

// 3) 결제·정산 감시 — 연체·실패 집계
async function payWatch(): Promise<AgentResult> {
  const r = await queryOne<Record<string, string>>(`SELECT
    (SELECT count(*) FROM brands WHERE pay_status='past_due') past_due,
    (SELECT count(*) FROM settlements WHERE status='draft') draft_settle,
    (SELECT count(*) FROM settlements WHERE anomaly=true AND status='draft') anomaly`).catch(() => null);
  const s = r ?? {};
  return { summary: `연체 ${s.past_due ?? 0} · 정산 draft ${s.draft_settle ?? 0} · 이상치 ${s.anomaly ?? 0}`, detail: s };
}

// 4) 인증 만료·미비 감시 — cert_risk 알림 생성(브랜드당 1)
async function certWatch(): Promise<AgentResult> {
  const rows = await query<{ brand_id: string; brand_name: string; n: string }>(
    `SELECT pm.brand_id, b.brand_name, count(*)::text n
       FROM product_certs pc JOIN products_master pm ON pm.id=pc.product_id JOIN brands b ON b.id=pm.brand_id
      WHERE pc.status IN ('none','rejected','expired')
         OR (pc.expires_at IS NOT NULL AND pc.expires_at < current_date + interval '30 days')
      GROUP BY pm.brand_id, b.brand_name`).catch(() => []);
  let made = 0;
  for (const r of rows) {
    const exists = await queryOne<{ id: string }>(
      "SELECT id FROM alerts WHERE brand_id=$1 AND kind='cert_risk' AND resolved_at IS NULL", [r.brand_id]).catch(() => null);
    if (exists) continue;
    // UNIQUE(brand_id,kind) — 과거 resolved 행이 있으면 DO NOTHING 이라 재발생 안 됨(버그).
    //   ON CONFLICT 시 resolved_at=NULL 로 되살려 재알림. (다른 인증이 새로 만료돼도 다시 뜸)
    await query(
      `INSERT INTO alerts (brand_id, kind, tier, message) VALUES ($1,'cert_risk',1,$2)
       ON CONFLICT (brand_id,kind) DO UPDATE SET resolved_at=NULL, tier=1, message=EXCLUDED.message, created_at=now()`,
      [r.brand_id, `${r.brand_name} · 인증 만료/미비 ${r.n}건 — 판매 리스크`]).catch(() => {});
    made++;
  }
  return { summary: `인증 리스크 브랜드 ${rows.length} · 신규 알림 ${made}`, actions: made };
}

// 5) 사이클 이행률 감시
async function cycleWatch(): Promise<AgentResult> {
  const { watchCycles } = await import("./operations");
  const n = await watchCycles().catch(() => 0);
  return { summary: `사이클 이행률 미달 알림 ${n}건`, actions: n };
}

// 6) 무응답 감시
async function noReplyWatch(): Promise<AgentResult> {
  const { detectNoReply } = await import("./email-sync");
  const n = await detectNoReply(3).catch(() => 0);
  return { summary: `무응답(3영업일) 알림 ${n}건`, actions: n };
}

// 7) 미팅 후처리 — 전사→요약→팔로업(키 있을 때)
async function meetingFollowup(): Promise<AgentResult> {
  const { processMeetings, detectNoShows } = await import("./meeting-process");
  const [proc, noShow] = await Promise.all([processMeetings(5).catch(() => ({ summarized: 0, skipped: 0 })), detectNoShows().catch(() => 0)]);
  return { summary: `회의록 요약 ${proc.summarized} · 스킵 ${proc.skipped} · 노쇼 ${noShow}`, actions: proc.summarized };
}

// 8) 주간 자가학습 — 퍼널 지표 → 인사이트(+AI 제언)
async function weeklyInsight(): Promise<AgentResult> {
  const funnel = await query<{ state: string; count: number; avg_days: number | null }>(
    `SELECT state, count(*)::int count, round(avg(extract(epoch FROM (now()-stage_entered_at))/86400)::numeric,1) avg_days
       FROM brands WHERE state NOT IN ('dropped','churned') GROUP BY state`).catch(() => []);
  const week = new Date().toISOString().slice(0, 10);
  const metricText = funnel.map((f) => `${f.state}:${f.count}(${f.avg_days ?? "-"}d)`).join(" · ");
  let finding = "퍼널 스냅샷 저장", action = "";
  if (aiEnabled()) {
    const ai = await aiText({
      system: "너는 GloveK 운영 분석가다. 퍼널 지표에서 병목·개선점을 2~3줄로 간결히 제시한다. 판정·정책변경은 하지 말고 제안만.",
      user: `단계별 브랜드수·평균체류일:\n${metricText}\n\n병목과 개선 제안을 알려줘.`,
      maxTokens: 400,
    }).catch(() => null);
    if (ai) { finding = ai; action = "AI 제언 — 사람 검토 필요"; }
  }
  await query(
    `INSERT INTO insights (week, metric, value, finding, proposed_action) VALUES ($1,'funnel',$2,$3,$4)`,
    [week, JSON.stringify({ funnel }), finding, action]).catch(() => {});
  return { summary: `주간 인사이트 저장 · ${metricText}`, actions: 1, detail: { funnel } };
}

// 9) 사전분석 — 브리프 없는 브랜드 진단(+AI 브리프)
async function preAnalysis(): Promise<AgentResult> {
  const brands = await query<{ id: string; brand_name: string; category: string; grade: string | null }>(
    "SELECT id, brand_name, category, grade FROM brands WHERE (brief_md IS NULL OR brief_md='') AND state NOT IN ('dropped','churned') LIMIT 10").catch(() => []);
  let made = 0;
  for (const b of brands) {
    let brief = `## ${b.brand_name} 사전분석(자동)\n- 카테고리: ${b.category || "미상"}\n- 등급: ${b.grade ?? "미정"}\n- 정보 부족 — 미팅 검증 필요`;
    if (aiEnabled()) {
      const ai = await aiText({
        system: "너는 GloveK 사전분석가다. 주어진 최소 정보로 브랜드 진단 브리프(강점가설·추천트랙·확인질문 3개)를 6줄 이내로. 과장 금지.",
        user: `브랜드: ${b.brand_name} / 카테고리: ${b.category} / 등급: ${b.grade ?? "미정"}`,
        maxTokens: 400,
      }).catch(() => null);
      if (ai) brief = ai;
    }
    await query("UPDATE brands SET brief_md=$2 WHERE id=$1", [b.id, brief]).catch(() => {});
    made++;
  }
  return { summary: `사전분석 브리프 ${made}건 생성${aiEnabled() ? "(AI)" : "(규칙기반)"}`, actions: made };
}

// 10) 인바운드 자동 회신 초안 — 미답 고객 메일 → 요약 + 근거기반 회신 초안(초안함)
async function inboundReply(): Promise<AgentResult> {
  const { draftInboundReplies } = await import("./inbound-reply");
  const r = await draftInboundReplies(10).catch(() => ({ pending: 0, drafted: 0, ai: false }));
  return {
    summary: `미답 수신메일 ${r.pending}건 · 회신초안 ${r.drafted}건 생성(초안함)${r.ai ? "(AI)" : "(규칙-수동작성)"}`,
    actions: r.drafted, detail: { ...r },
  };
}

// ── 레지스트리 ─────────────────────────────────────────────────
export const AGENTS: AgentDef[] = [
  { key: "daily_ops_check", label: "일일 운영 점검", schedule: "매일 09:00", kind: "deterministic",
    desc: "SLA·게이트·서류·미배정·접촉공백을 집계해 파트별 요약", run: dailyOpsCheck },
  { key: "doc_reminder", label: "서류 리마인더", schedule: "매일 14:00", kind: "deterministic",
    desc: "docs 단계 미완 브랜드에 리마인더 초안 생성(초안함)", run: docReminder },
  { key: "pay_watch", label: "결제·정산 감시", schedule: "매일 10:00", kind: "deterministic",
    desc: "연체·정산 draft·이상치 집계", run: payWatch },
  { key: "cert_watch", label: "인증 만료 감시", schedule: "매일 08:00", kind: "deterministic",
    desc: "만료 임박·미비 인증 → 판매 리스크 알림", run: certWatch },
  { key: "cycle_watch", label: "운영 사이클 감시", schedule: "매일 09:30", kind: "deterministic",
    desc: "월중 이행률 미달(15일 이후) 알림", run: cycleWatch },
  { key: "no_reply_watch", label: "무응답 감시", schedule: "매일 11:00", kind: "deterministic",
    desc: "발송 후 3영업일 무응답 → 재접촉 알림", run: noReplyWatch },
  { key: "meeting_followup", label: "미팅 후처리", schedule: "10분마다", kind: "ai",
    desc: "녹음 전사→회의록 요약→팔로업 초안·노쇼 감지(AI 키 필요)", run: meetingFollowup },
  { key: "weekly_insight", label: "주간 자가학습", schedule: "매주 월 09:00", kind: "ai",
    desc: "퍼널 지표 분석·인사이트 저장(AI 제언)", run: weeklyInsight },
  { key: "pre_analysis", label: "사전분석", schedule: "신규 유입 + 매일 11:30", kind: "ai",
    desc: "브리프 없는 브랜드 진단(AI 브리프)", run: preAnalysis },
  { key: "inbound_reply", label: "인바운드 자동 회신", schedule: "매시(메일 수집 직후)", kind: "ai",
    desc: "미답 고객 메일 요약 + 우리 데이터 근거 회신 초안(초안함) — 담당 승인 후 발송", run: inboundReply },
];

export function getAgent(key: string): AgentDef | undefined {
  return AGENTS.find((a) => a.key === key);
}

// ── 실행 엔진 (로그·on/off) ────────────────────────────────────
export async function runAgent(key: string, triggeredBy = "manual"): Promise<{ ok: boolean; summary: string; error?: string }> {
  const def = getAgent(key);
  if (!def) return { ok: false, summary: "", error: "unknown agent" };

  // on/off 확인(비활성이면 스킵, 단 manual 은 강제 실행)
  const cfg = await queryOne<{ enabled: boolean }>("SELECT enabled FROM agent_config WHERE agent=$1", [key]).catch(() => null);
  if (cfg && cfg.enabled === false && triggeredBy !== "manual") {
    return { ok: true, summary: "비활성(스킵)" };
  }

  const runRow = await queryOne<{ id: string }>(
    "INSERT INTO agent_runs (agent, status, triggered_by) VALUES ($1,'running',$2) RETURNING id", [key, triggeredBy]).catch(() => null);
  const runId = runRow?.id;
  try {
    const res = await def.run();
    await query("UPDATE agent_runs SET status='ok', summary=$2, actions=$3, detail=$4, finished_at=now() WHERE id=$1",
      [runId, res.summary, res.actions ?? 0, JSON.stringify(res.detail ?? {})]).catch(() => {});
    await query(
      `INSERT INTO agent_config (agent, last_run) VALUES ($1, now())
       ON CONFLICT (agent) DO UPDATE SET last_run=now()`, [key]).catch(() => {});
    return { ok: true, summary: res.summary };
  } catch (e) {
    await query("UPDATE agent_runs SET status='error', summary=$2, finished_at=now() WHERE id=$1",
      [runId, (e as Error).message]).catch(() => {});
    return { ok: false, summary: "", error: (e as Error).message };
  }
}

/** 스케줄러가 호출: enabled 에이전트 전체 실행(또는 특정 key). */
export async function runScheduledAgents(only?: string): Promise<{ ran: string[]; results: Record<string, string> }> {
  const keys = only ? [only] : AGENTS.map((a) => a.key);
  const results: Record<string, string> = {};
  const ran: string[] = [];
  for (const k of keys) {
    const r = await runAgent(k, "cron");
    results[k] = r.ok ? r.summary : `error: ${r.error}`;
    ran.push(k);
  }
  return { ran, results };
}

// 관리 화면용 조회
export interface AgentView extends AgentDef { enabled: boolean; last_run: string | null; last?: { status: string; summary: string; started_at: string } }
export async function listAgentViews(): Promise<AgentView[]> {
  const cfgs = await query<{ agent: string; enabled: boolean; last_run: string | null }>("SELECT agent, enabled, last_run FROM agent_config").catch(() => []);
  const cfgMap = new Map(cfgs.map((c) => [c.agent, c]));
  const lasts = await query<{ agent: string; status: string; summary: string; started_at: string }>(
    `SELECT DISTINCT ON (agent) agent, status, summary, started_at FROM agent_runs ORDER BY agent, started_at DESC`).catch(() => []);
  const lastMap = new Map(lasts.map((l) => [l.agent, l]));
  return AGENTS.map((a) => ({
    ...a,
    enabled: cfgMap.get(a.key)?.enabled ?? true,
    last_run: cfgMap.get(a.key)?.last_run ?? null,
    last: lastMap.get(a.key),
  }));
}

export async function setAgentEnabled(key: string, enabled: boolean): Promise<void> {
  await query(
    `INSERT INTO agent_config (agent, enabled) VALUES ($1,$2)
     ON CONFLICT (agent) DO UPDATE SET enabled=EXCLUDED.enabled`, [key, enabled]);
}

export function recentRuns(limit = 30) {
  return query<{ agent: string; status: string; summary: string; actions: number; triggered_by: string; started_at: string }>(
    "SELECT agent, status, summary, actions, triggered_by, started_at FROM agent_runs ORDER BY started_at DESC LIMIT $1", [limit]);
}
