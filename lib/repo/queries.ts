import { query, queryOne, queryRo } from "../db";
import { docProgress, type DocProgress } from "../docs";
import type { Brand, State } from "../types";

// 대시보드 읽기 쿼리 (04-DASHBOARD).

export interface BoardCard extends Brand {
  has_breach: boolean;
  owners_display: string | null;
}

export async function boardCards(): Promise<BoardCard[]> {
  return query<BoardCard>(
    `SELECT b.*,
            EXISTS(SELECT 1 FROM alerts a WHERE a.brand_id=b.id AND a.kind='sla_breach' AND a.resolved_at IS NULL) AS has_breach,
            NULLIF(concat_ws(', ', b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads), '') AS owners_display
       FROM brands b
      ORDER BY b.stage_entered_at ASC`,
  );
}

export interface Brand360 {
  brand: Brand;
  signals: { source: string; metric: string; value_num: number | null; value_text: string | null; confidence: string; collected_at: string }[];
  docs: DocProgress;
  paymentsManual: { id: string; plan: string; amount: number; method: string; paid_at: string; next_due: string | null; note: string }[];
  glovekSubs: { plan: string; amount: number | null; status: string; next_charge_at: string | null; failures: number | null }[];
  timeline: { kind: string; text: string; at: string; actor: string }[];
  alerts: { id: string; kind: string; tier: number; message: string; created_at: string }[];
  adminUsers: { id: string; name: string; role: string }[];
}

export async function brand360(id: string): Promise<Brand360 | null> {
  const brand = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [id]);
  if (!brand) return null;

  const [signals, docs, paymentsManual, history, sources, alerts, adminUsers] = await Promise.all([
    query<Brand360["signals"][number]>(
      "SELECT source, metric, value_num, value_text, confidence, collected_at FROM brand_signals WHERE brand_id=$1 ORDER BY collected_at DESC",
      [id],
    ),
    docProgress(id),
    query<Brand360["paymentsManual"][number]>(
      "SELECT id, plan, amount, method, paid_at, next_due, note FROM payments_manual WHERE brand_id=$1 ORDER BY paid_at DESC",
      [id],
    ),
    query<{ from_state: string | null; to_state: string; actor: string; gate_passed: boolean; reason: string; at: string }>(
      "SELECT from_state, to_state, actor, gate_passed, reason, at FROM stage_history WHERE brand_id=$1 ORDER BY at DESC LIMIT 30",
      [id],
    ),
    query<{ site: string; event: string; source_url: string | null; occurred_at: string }>(
      "SELECT site, event, source_url, occurred_at FROM brand_sources WHERE brand_id=$1 ORDER BY occurred_at DESC LIMIT 30",
      [id],
    ),
    query<Brand360["alerts"][number]>(
      "SELECT id, kind, tier, message, created_at FROM alerts WHERE brand_id=$1 AND resolved_at IS NULL ORDER BY tier DESC",
      [id],
    ),
    query<{ id: string; name: string; role: string }>(
      "SELECT id, name, role FROM admin_users WHERE active ORDER BY role",
    ),
  ]);

  // glovek 구독(읽기전용). 미연동/로컬이면 빈 배열.
  let glovekSubs: Brand360["glovekSubs"] = [];
  if (brand.glovek_user_id) {
    try {
      glovekSubs = await queryRo<Brand360["glovekSubs"][number]>(
        `SELECT plan, amount, status, next_charge_at, failures FROM mall_subscriptions WHERE user_id=$1`,
        [brand.glovek_user_id],
      );
    } catch {
      glovekSubs = [];
    }
  }

  const timeline = [
    ...history.map((h) => ({
      kind: h.gate_passed ? "stage" : "gate_fail",
      text: `${h.from_state ?? "?"} → ${h.to_state}${h.reason ? ` · ${h.reason}` : ""}`,
      at: h.at,
      actor: h.actor,
    })),
    ...sources.map((s) => ({
      kind: "source",
      text: `${s.site} · ${s.event}`,
      at: s.occurred_at,
      actor: s.site,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return { brand, signals, docs, paymentsManual, glovekSubs, timeline, alerts, adminUsers };
}

/** 워크큐 — 역할별 담당 브랜드. 위반·오늘마감·액션없음 순. */
export async function queueBrands(ownerField: string | null, ownerId: string): Promise<BoardCard[]> {
  if (!ownerField) {
    // lead/exec/settle → 전체 진행 브랜드
    return query<BoardCard>(
      `SELECT b.*, EXISTS(SELECT 1 FROM alerts a WHERE a.brand_id=b.id AND a.kind='sla_breach' AND a.resolved_at IS NULL) AS has_breach,
              NULLIF(concat_ws(', ', b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads),'') AS owners_display
         FROM brands b WHERE b.state NOT IN ('dropped','churned')
        ORDER BY has_breach DESC, b.due_date ASC NULLS LAST, b.next_action ASC LIMIT 100`,
    );
  }
  return query<BoardCard>(
    `SELECT b.*, EXISTS(SELECT 1 FROM alerts a WHERE a.brand_id=b.id AND a.kind='sla_breach' AND a.resolved_at IS NULL) AS has_breach,
            NULLIF(concat_ws(', ', b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads),'') AS owners_display
       FROM brands b
      WHERE b.${ownerField} = $1 AND b.state NOT IN ('dropped','churned')
      ORDER BY has_breach DESC, b.due_date ASC NULLS LAST, b.next_action ASC LIMIT 100`,
    [ownerId],
  );
}

export interface MonitorData {
  alerts: { id: string; brand_id: string; brand_name: string; kind: string; tier: number; message: string; snoozed_until: string | null; created_at: string }[];
  gateViolations: { brand_name: string; reason: string; at: string; actor: string }[];
}

export async function monitorData(): Promise<MonitorData> {
  const [alerts, gateViolations] = await Promise.all([
    query<MonitorData["alerts"][number]>(
      `SELECT a.id, a.brand_id, b.brand_name, a.kind, a.tier, a.message, a.snoozed_until, a.created_at
         FROM alerts a JOIN brands b ON b.id=a.brand_id
        WHERE a.resolved_at IS NULL ORDER BY a.tier DESC, a.created_at ASC`,
    ),
    query<MonitorData["gateViolations"][number]>(
      `SELECT b.brand_name, sh.reason, sh.at, sh.actor
         FROM stage_history sh JOIN brands b ON b.id=sh.brand_id
        WHERE sh.gate_passed = false AND sh.at > now() - interval '14 days'
        ORDER BY sh.at DESC LIMIT 50`,
    ),
  ]);
  return { alerts, gateViolations };
}

export interface PayData {
  activeSubs: number;
  pastDue: number;
  mrr: number;
  onetimeThisMonth: number;
  subs: { brand_name: string; plan: string | null; amount: number | null; status: string; next_charge_at: string | null; failures: number | null; brand_id: string }[];
  onetime: { brand_name: string; plan: string; amount: number; paid_at: string; kind: string }[];
}

export async function payData(): Promise<PayData> {
  // glovek 구독 조인 — 미연동이면 brands.pay_status 기반 폴백.
  let subs: PayData["subs"] = [];
  try {
    subs = await queryRo<PayData["subs"][number]>(
      `SELECT b.brand_name, ms.plan, ms.amount, ms.status, ms.next_charge_at, ms.failures, b.id AS brand_id
         FROM mall_subscriptions ms
         JOIN brands b ON b.glovek_user_id = ms.user_id::text`,
    );
  } catch {
    subs = await query<PayData["subs"][number]>(
      `SELECT brand_name, plan, NULL::int amount, pay_status AS status, NULL::timestamptz next_charge_at, NULL::int failures, id AS brand_id
         FROM brands WHERE pay_status IN ('subscribed','past_due')`,
    );
  }

  const manual = await query<{ brand_name: string; plan: string; amount: number; paid_at: string }>(
    `SELECT b.brand_name, pm.plan, pm.amount, pm.paid_at
       FROM payments_manual pm JOIN brands b ON b.id=pm.brand_id
      ORDER BY pm.paid_at DESC`,
  );

  const activeSubs = subs.filter((s) => s.status === "subscribed" || s.status === "active").length;
  const pastDue = subs.filter((s) => s.status === "past_due").length;
  const mrr = subs.reduce((sum, s) => sum + (s.amount ?? 490_000) * (s.status === "past_due" ? 0 : 1), 0);

  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const onetimeThisMonth = manual
    .filter((m) => m.paid_at >= monthStart)
    .reduce((s, m) => s + m.amount, 0);

  return {
    activeSubs,
    pastDue,
    mrr,
    onetimeThisMonth,
    subs,
    onetime: manual.map((m) => ({ ...m, kind: "manual" })),
  };
}

export interface FunnelStage {
  state: State;
  count: number;
  avg_days: number | null;
}

export async function insightsData(): Promise<{
  funnel: FunnelStage[];
  bySource: { source: string; total: number; reached_contract: number }[];
  insights: { week: string; metric: string; finding: string; proposed_action: string; approved: boolean | null; id: string }[];
  churnRisk: { id: string; brand_name: string; churn_risk: string; state: string }[];
}> {
  const [funnel, bySource, insights, churnRisk] = await Promise.all([
    query<FunnelStage>(
      `SELECT state, count(*)::int AS count,
              round(avg(extract(epoch FROM (now()-stage_entered_at))/86400)::numeric,1) AS avg_days
         FROM brands GROUP BY state`,
    ),
    query<{ source: string; total: number; reached_contract: number }>(
      `SELECT source, count(*)::int total,
              count(*) FILTER (WHERE state IN ('contract_done','docs','setup','live_mall','live_onboarding','settling'))::int reached_contract
         FROM brands GROUP BY source ORDER BY total DESC`,
    ),
    query<{ week: string; metric: string; finding: string; proposed_action: string; approved: boolean | null; id: string }>(
      "SELECT id, week, metric, finding, proposed_action, approved FROM insights ORDER BY week DESC, created_at DESC LIMIT 50",
    ),
    query<{ id: string; brand_name: string; churn_risk: string; state: string }>(
      "SELECT id, brand_name, churn_risk, state FROM brands WHERE churn_risk='high' AND state NOT IN ('dropped','churned') ORDER BY brand_name",
    ),
  ]);
  return { funnel, bySource, insights, churnRisk };
}

export async function adminUserList(): Promise<{ id: string; name: string; role: string; slack_user_id: string | null; active: boolean }[]> {
  return query("SELECT id, name, role, slack_user_id, active FROM admin_users ORDER BY role, name");
}

export async function slaPolicyList(): Promise<{ state: string; max_days: number; note: string }[]> {
  return query("SELECT state, max_days, note FROM sla_policies ORDER BY max_days");
}
