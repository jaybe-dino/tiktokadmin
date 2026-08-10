import { query, queryOne, queryRo } from "../db";
import { docProgress, type DocProgress } from "../docs";
import { listFiles, listProposals, type BrandFile, type Proposal } from "./customer";
import type { Brand, State } from "../types";

// 대시보드 읽기 쿼리 (04-DASHBOARD).

export interface BoardCard extends Brand {
  has_breach: boolean;
  owners_display: string | null;
}

export async function boardCards(): Promise<BoardCard[]> {
  // 종료(dropped/churned)·테스트(is_test) 브랜드는 SQL 에서 제외 —
  //   JS 후필터/전행 전송 제거(성능) + KPI 격리 기준과 일치(테스트 데이터 미표시).
  return query<BoardCard>(
    `SELECT b.*,
            EXISTS(SELECT 1 FROM alerts a WHERE a.brand_id=b.id AND a.kind='sla_breach' AND a.resolved_at IS NULL) AS has_breach,
            NULLIF(concat_ws(', ', b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads), '') AS owners_display
       FROM brands b
      WHERE b.state NOT IN ('dropped','churned') AND coalesce(b.is_test,false)=false
      ORDER BY b.stage_entered_at ASC`,
  );
}

export interface Brand360 {
  brand: Brand;
  signals: { source: string; metric: string; value_num: number | null; value_text: string | null; confidence: string; collected_at: string }[];
  docs: DocProgress;
  paymentsManual: { id: string; plan: string; amount: number; method: string; paid_at: string; next_due: string | null; note: string }[];
  glovekSubs: { plan: string; amount: number | null; status: string; next_charge_at: string | null; failures: number | null }[];
  // link: 키워드 클릭 시 이동할 탭(및 스크롤 앵커) — 미팅·메일 등 커뮤 내용으로 점프.
  timeline: { kind: string; text: string; at: string; actor: string; link?: { tab: string; anchor?: string } }[];
  // 원본 단계 이력(최근 30) — 페이지에서 moveHistory(성공 이동)를 파생해 중복 조회 제거.
  stageHistory: { from_state: string | null; to_state: string; actor: string; gate_passed: boolean; reason: string; at: string }[];
  alerts: { id: string; kind: string; tier: number; message: string; created_at: string }[];
  adminUsers: { id: string; name: string; role: string }[];
  files: BrandFile[];
  proposals: Proposal[];
  sites: string[];
}

export async function brand360(id: string): Promise<Brand360 | null> {
  // 잘못된 uuid(공백·오타)면 500 대신 null → notFound.
  const cleanId = id.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId)) return null;
  const brand = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [cleanId]);
  if (!brand) return null;
  id = cleanId;

  // 각 조회를 개별 방어 — 하나가 실패해도 카드 전체가 죽지 않게.
  const safe = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
  const [signals, docs, paymentsManual, history, sources, alerts, adminUsers, meetings] = await Promise.all([
    safe(query<Brand360["signals"][number]>(
      "SELECT source, metric, value_num, value_text, confidence, collected_at FROM brand_signals WHERE brand_id=$1 ORDER BY collected_at DESC",
      [id],
    )),
    docProgress(id).catch(() => ({ done: 0, total: 0, missing: [] as string[], items: [] as DocProgress["items"] })),
    safe(query<Brand360["paymentsManual"][number]>(
      "SELECT id, plan, amount, method, paid_at, next_due, note FROM payments_manual WHERE brand_id=$1 ORDER BY paid_at DESC",
      [id],
    )),
    safe(query<{ from_state: string | null; to_state: string; actor: string; gate_passed: boolean; reason: string; at: string }>(
      "SELECT from_state, to_state, actor, gate_passed, reason, at FROM stage_history WHERE brand_id=$1 ORDER BY at DESC LIMIT 30",
      [id],
    )),
    safe(query<{ site: string; event: string; source_url: string | null; payload: Record<string, unknown> | null; occurred_at: string }>(
      "SELECT site, event, source_url, payload, occurred_at FROM brand_sources WHERE brand_id=$1 ORDER BY occurred_at DESC LIMIT 40",
      [id],
    )),
    safe(query<Brand360["alerts"][number]>(
      "SELECT id, kind, tier, message, created_at FROM alerts WHERE brand_id=$1 AND resolved_at IS NULL ORDER BY tier DESC",
      [id],
    )),
    safe(query<{ id: string; name: string; role: string }>(
      "SELECT id, name, role FROM admin_users WHERE active ORDER BY role",
    )),
    // 미팅캘린더 맵핑(타임라인 반영) — 위 조회들과 병렬로(순차 왕복 제거).
    safe(query<{ id: string; topic: string; status: string; scheduled_at: string | null; summary: string | null; created_at: string }>(
      "SELECT id, topic, status, scheduled_at, left(coalesce(summary_md,''), 300) AS summary, created_at FROM meetings WHERE brand_id=$1 ORDER BY coalesce(scheduled_at, created_at) DESC LIMIT 20",
      [id],
    )),
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

  // 미팅캘린더 맵핑을 타임라인에 반영(4-2) — meetings 는 위 Promise.all 에서 병렬 조회됨.
  const MST: Record<string, string> = { scheduled: "예약", received: "수신", ready: "완료", unmatched: "매칭필요", no_show: "노쇼", canceled: "취소", error: "오류" };

  // brand_sources 행 → 내용 포함 텍스트(4-4). payload(채널·종류·메모·직접입력)를 함께 노출.
  const sourceText = (s: { site: string; event: string; source_url: string | null; payload: Record<string, unknown> | null }): string => {
    const p = s.payload ?? {};
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    if (s.event === "note" && str("text")) return `📝 ${str("text")}`;   // 직접 입력 메모(4-3)
    const detail = [str("kind"), str("intake"), str("channel")].filter(Boolean).join(" · ");
    return `${s.site} · ${s.event}${detail ? ` · ${detail}` : ""}${s.source_url ? ` (${s.source_url})` : ""}`;
  };

  const timeline = [
    ...history.map((h) => ({
      kind: h.gate_passed ? "stage" : "gate_fail",
      text: `${h.from_state ?? "?"} → ${h.to_state}${h.reason ? ` · ${h.reason}` : ""}`,
      at: h.at,
      actor: h.actor,
    })),
    // 미팅 contact_logged 소스는 미팅 엔트리와 중복되므로 제외.
    ...sources
      .filter((s) => !(s.event === "contact_logged" && (s.payload as Record<string, unknown> | null)?.channel === "meeting"))
      .map((s) => {
        // 이메일/메일 관련 커뮤 소스는 클릭 시 미팅·메일 탭으로 이동.
        const channel = typeof (s.payload as Record<string, unknown> | null)?.channel === "string" ? String((s.payload as Record<string, unknown>).channel) : "";
        const isMail = channel === "email" || channel === "mail" || s.event === "email" || s.event === "email_sent";
        return {
          kind: "source",
          text: sourceText(s),
          at: s.occurred_at,
          actor: s.site,
          ...(isMail ? { link: { tab: "mm" } } : {}),
        };
      }),
    ...meetings.map((m) => ({
      kind: "meeting",
      text: `🎥 미팅: ${m.topic || "(제목 없음)"} · ${MST[m.status] ?? m.status}${m.summary ? ` — ${m.summary}` : ""}`,
      at: m.scheduled_at ?? m.created_at,
      actor: "meeting",
      link: { tab: "mm", anchor: `mtg-${m.id}` },
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // 고객 상세(파일·제안서)·유입소스 — 마이그레이션(0004) 미적용 DB 에서도 카드가 뜨도록 방어.
  let files: BrandFile[] = [];
  let proposals: Proposal[] = [];
  let sites: string[] = [];
  try {
    const [f, p, siteRows] = await Promise.all([
      listFiles(id),
      listProposals(id),
      query<{ site: string }>("SELECT DISTINCT site FROM brand_sources WHERE brand_id=$1", [id]),
    ]);
    files = f;
    proposals = p;
    sites = siteRows.map((s) => s.site);
  } catch (err) {
    console.warn("[brand360] 상세/소스 조회 스킵:", (err as Error).message);
  }

  return {
    brand, signals, docs, paymentsManual, glovekSubs, timeline, stageHistory: history, alerts, adminUsers,
    files, proposals, sites,
  };
}

// ── 중복 후보 (자동 dedup 이 놓친 것) ────────────────────────
export interface DuplicateGroup {
  kind: "phone" | "biz_no" | "brand_name";
  key: string;
  brands: { id: string; brand_name: string; email: string | null; phone: string | null; state: string }[];
}

export async function findDuplicateGroups(): Promise<DuplicateGroup[]> {
  const agg =
    "json_agg(json_build_object('id',id,'brand_name',brand_name,'email',email,'phone',phone,'state',state) ORDER BY created_at)";
  // 테스트·종료(dropped/churned) 브랜드는 중복 후보에서 제외 — 다른 화면과 수치 일관. (pipeline#4)
  const notTestActive = "coalesce(is_test,false)=false AND state NOT IN ('dropped','churned')";
  const [byPhone, byBiz, byName] = await Promise.all([
    query<{ key: string; brands: DuplicateGroup["brands"] }>(
      `SELECT phone AS key, ${agg} AS brands FROM brands
        WHERE phone IS NOT NULL AND phone<>'' AND ${notTestActive} GROUP BY phone HAVING count(*)>1`,
    ),
    query<{ key: string; brands: DuplicateGroup["brands"] }>(
      `SELECT biz_no AS key, ${agg} AS brands FROM brands
        WHERE biz_no IS NOT NULL AND biz_no<>'' AND ${notTestActive} GROUP BY biz_no HAVING count(*)>1`,
    ),
    query<{ key: string; brands: DuplicateGroup["brands"] }>(
      `SELECT lower(brand_name) AS key, ${agg} AS brands FROM brands
        WHERE brand_name<>'' AND brand_name<>'(미상)' AND ${notTestActive} GROUP BY lower(brand_name) HAVING count(*)>1`,
    ),
  ]);
  return [
    ...byPhone.map((g) => ({ kind: "phone" as const, key: g.key, brands: g.brands })),
    ...byBiz.map((g) => ({ kind: "biz_no" as const, key: g.key, brands: g.brands })),
    ...byName.map((g) => ({ kind: "brand_name" as const, key: g.key, brands: g.brands })),
  ];
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
  gateViolationCount: number;
}

export async function monitorData(): Promise<MonitorData> {
  const [alerts, gateViolations, gvCount] = await Promise.all([
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
    // 타일 수치는 목록 LIMIT 와 무관하게 전체 건수로 집계(50 초과 언더카운트 방지, pipeline#11).
    queryOne<{ n: string }>(
      `SELECT count(*)::text n FROM stage_history sh
        WHERE sh.gate_passed = false AND sh.at > now() - interval '14 days'`),
  ]);
  return { alerts, gateViolations, gateViolationCount: Number(gvCount?.n ?? gateViolations.length) };
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
  // MRR — 실제 구독 금액(amount)만 합산. 금액 미연동(null)은 0 으로 집계(가짜 폴백 금지, sales#4).
  const mrr = subs.reduce((sum, s) => sum + (s.status === "past_due" ? 0 : Number(s.amount ?? 0)), 0);

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

// ── 고객 목록 (검색·필터·페이지네이션) ──────────────────────
export interface CustomerRow extends Brand {
  has_breach: boolean;
  owners_display: string | null;
  sites: string | null;
}

const CUSTOMER_SORTS: Record<string, string> = {
  updated: "b.updated_at DESC NULLS LAST",
  created: "b.created_at DESC NULLS LAST",
  created_asc: "b.created_at ASC NULLS LAST",
  contact: "b.last_contact_at DESC NULLS LAST",
  name: "b.brand_name ASC",
};

export async function customersList(f: {
  q?: string; state?: string; source?: string; grade?: string;
  plan?: string; owner?: string; breach?: boolean; sort?: string; page?: number;
}): Promise<{ rows: CustomerRow[]; total: number; page: number; pages: number }> {
  const where: string[] = ["1=1"];
  const p: unknown[] = [];
  if (f.q) {
    p.push(`%${f.q}%`);
    where.push(`(b.brand_name ILIKE $${p.length} OR b.email ILIKE $${p.length} OR b.phone ILIKE $${p.length})`);
  }
  if (f.state) { p.push(f.state); where.push(`b.state=$${p.length}`); }
  // 상태 지정이 없으면 종료(dropped/churned) 제외 — 관리 목록에서 숨김. 명시 필터 시엔 표시.
  else where.push(`b.state NOT IN ('dropped','churned')`);
  if (f.source) { p.push(f.source); where.push(`b.source=$${p.length}`); }
  if (f.grade) { p.push(f.grade); where.push(`b.grade=$${p.length}`); }
  if (f.plan) { p.push(f.plan); where.push(`b.plan=$${p.length}`); }
  // 담당 필터 — owner_* 는 admin_users.id 저장 → 넘어온 값도 id 여야 매칭됨(전 페이지 대상).
  if (f.owner) {
    p.push(f.owner);
    where.push(`$${p.length} IN (b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads)`);
  }
  if (f.breach) {
    where.push(`EXISTS(SELECT 1 FROM alerts a WHERE a.brand_id=b.id AND a.kind='sla_breach' AND a.resolved_at IS NULL)`);
  }

  const whereSql = where.join(" AND ");
  const countRow = await queryOne<{ n: string }>(`SELECT count(*)::text n FROM brands b WHERE ${whereSql}`, p);
  const total = Number(countRow?.n ?? 0);

  const page = Math.max(1, f.page ?? 1);
  const perPage = 50;
  const offset = (page - 1) * perPage;

  const rows = await query<CustomerRow>(
    `SELECT b.*,
            EXISTS(SELECT 1 FROM alerts a WHERE a.brand_id=b.id AND a.kind='sla_breach' AND a.resolved_at IS NULL) AS has_breach,
            NULLIF(concat_ws(', ', b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads), '') AS owners_display,
            (SELECT string_agg(DISTINCT site, ',') FROM brand_sources s WHERE s.brand_id=b.id) AS sites
       FROM brands b
      WHERE ${whereSql}
      ORDER BY ${CUSTOMER_SORTS[f.sort ?? "updated"] ?? CUSTOMER_SORTS.updated}
      LIMIT ${perPage} OFFSET ${offset}`,
    p,
  );
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function adminUserList(): Promise<{ id: string; name: string; role: string; slack_user_id: string | null; active: boolean }[]> {
  return query("SELECT id, name, role, slack_user_id, active FROM admin_users ORDER BY role, name");
}

export interface AccountRow {
  id: string; name: string; role: string; active: boolean;
  zoom_email: string | null; has_password: boolean; password_set_at: string | null;
}
export async function accountList(): Promise<AccountRow[]> {
  return query<AccountRow>(
    `SELECT id, name, role, active, zoom_email,
            (password_hash IS NOT NULL) AS has_password, password_set_at
       FROM admin_users
      ORDER BY (role='exec') DESC, (role='lead') DESC, name`).catch(() => []);
}

export async function slaPolicyList(): Promise<{ state: string; max_days: number; note: string }[]> {
  return query("SELECT state, max_days, note FROM sla_policies ORDER BY max_days");
}
