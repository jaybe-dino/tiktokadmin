// 운영대행 엔진 (15) — 사이클 발행·시딩·정산 계산. 순수 규칙 + DB.
import { query, queryOne, queryRo } from "./db";

// ── 플랜별 워크아이템 발행 규칙 (15 §2 cycle-open) ─────────────
export interface WorkItemSpec { kind: string; qty_target: number }
export function workItemsForPlan(plan: string | null, terms?: { seeding?: number; live?: number }): WorkItemSpec[] {
  switch (plan) {
    case "live_focus_490k":
      return [{ kind: "seeding", qty_target: 20 }, { kind: "live", qty_target: 4 }, { kind: "report", qty_target: 1 }];
    case "guarantee_1m":
      return [{ kind: "seeding", qty_target: 30 }, { kind: "live", qty_target: 6 }, { kind: "report", qty_target: 1 }];
    case "onboarding_onetime":
      return [
        { kind: "seeding", qty_target: terms?.seeding ?? 10 },
        { kind: "live", qty_target: terms?.live ?? 2 },
        { kind: "report", qty_target: 1 },
      ];
    default:
      return [{ kind: "seeding", qty_target: 10 }, { kind: "report", qty_target: 1 }];
  }
}

/** 이번 달 1일(UTC) date 문자열. */
export function monthFirst(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** 운영중 브랜드마다 사이클 개설 + 워크아이템 발행. 멱등(UNIQUE brand_id,month). */
export async function openCycles(month = monthFirst()): Promise<{ opened: number; items: number }> {
  const brands = await query<{ id: string; plan: string | null }>(
    "SELECT id, plan FROM brands WHERE state IN ('live_mall','live_onboarding','settling')");
  let opened = 0, items = 0;
  for (const b of brands) {
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM ops_cycles WHERE brand_id=$1 AND month=$2", [b.id, month]);
    if (existing) continue;

    // 계약 terms 로 온보딩 수량 보정
    const contract = await queryOne<{ terms: { seeding?: number; live?: number } }>(
      "SELECT terms FROM contracts WHERE brand_id=$1 AND status='signed' ORDER BY created_at DESC LIMIT 1", [b.id])
      .catch(() => null);
    const specs = workItemsForPlan(b.plan, contract?.terms);
    const total = specs.length;

    // 멱등: 동시 실행/재시도로 이미 발행된 경우 UNIQUE(brand_id,month) 충돌 → 조용히 스킵.
    const cycle = await queryOne<{ id: string }>(
      `INSERT INTO ops_cycles (brand_id, month, plan, items_total) VALUES ($1,$2,$3,$4)
       ON CONFLICT (brand_id, month) DO NOTHING RETURNING id`,
      [b.id, month, b.plan ?? "unknown", total]);
    if (!cycle) continue; // 충돌로 미삽입 → 워크아이템 중복 발행 방지
    for (const s of specs) {
      await query("INSERT INTO work_items (cycle_id, kind, qty_target) VALUES ($1,$2,$3)",
        [cycle.id, s.kind, s.qty_target]);
      items++;
    }
    opened++;
  }
  return { opened, items };
}

/** 사이클 이행률(15일 기준 50% 미달) 감시 → cycle_behind 알림. */
export async function watchCycles(now = new Date()): Promise<number> {
  // 월중 15일 이후에만 이행률 판정. 개설 초반엔 rate=0 이라 전 브랜드 오탐 폭주(#4).
  if (now.getUTCDate() < 15) return 0;
  const rows = await query<{ brand_id: string; done: number; total: number }>(
    `SELECT c.brand_id,
            COALESCE(sum(wi.qty_done),0)::int done,
            COALESCE(sum(wi.qty_target),0)::int total
       FROM ops_cycles c JOIN work_items wi ON wi.cycle_id=c.id
      WHERE c.status='active' AND c.month=$1
      GROUP BY c.brand_id`, [monthFirst(now)]);
  let n = 0;
  for (const r of rows) {
    if (r.total === 0) continue;
    const rate = r.done / r.total;
    if (rate >= 0.5) continue;
    const exists = await queryOne<{ id: string }>(
      "SELECT id FROM alerts WHERE brand_id=$1 AND kind='cycle_behind' AND resolved_at IS NULL", [r.brand_id]);
    if (exists) continue;
    await query("INSERT INTO alerts (brand_id, kind, tier, message) VALUES ($1,'cycle_behind',1,$2)",
      [r.brand_id, `사이클 이행률 ${Math.round(rate * 100)}% — 월중 점검 필요`]);
    n++;
  }
  return n;
}

// ── 정산 계산 (15 §4) ──────────────────────────────────────────
export interface SettlementCalc {
  gmv: number; feePct: number; feeAmount: number; subAmount: number; total: number;
  anomaly: boolean; anomalyNote: string;
}
/** contracts.terms.fee_pct × gmv + 구독분. est_gmv 대비 ±30% 이탈 시 anomaly. */
export function computeSettlement(input: {
  gmv: number; feePct: number; subAmount: number; estGmv?: number | null;
}): SettlementCalc {
  const feeAmount = Math.floor(input.gmv * (input.feePct / 100));
  const total = feeAmount + input.subAmount;
  let anomaly = false, anomalyNote = "";
  if (input.estGmv != null && input.estGmv > 0) {
    const dev = Math.abs(input.gmv - input.estGmv) / input.estGmv;
    if (dev > 0.3) {
      anomaly = true;
      anomalyNote = `est_gmv 대비 ${Math.round(dev * 100)}% 이탈 (GMV ${input.gmv} vs est ${input.estGmv})`;
    }
  }
  return { gmv: input.gmv, feePct: input.feePct, feeAmount, subAmount: input.subAmount, total, anomaly, anomalyNote };
}

/** 사이클 마감 시 정산 draft 생성. 멱등(UNIQUE brand_id,month). */
export async function closeCyclesAndDraftSettlements(month = monthFirst()): Promise<{ closed: number; settlements: number }> {
  const cycles = await query<{ id: string; brand_id: string }>(
    "SELECT id, brand_id FROM ops_cycles WHERE month=$1 AND status='active'", [month]);
  let closed = 0, settlements = 0;
  for (const c of cycles) {
    await query("UPDATE ops_cycles SET status='closed', closed_at=now() WHERE id=$1", [c.id]);
    closed++;

    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM settlements WHERE brand_id=$1 AND month=$2", [c.brand_id, month]);
    if (existing) continue;

    // fee_pct ← 계약 terms
    const contract = await queryOne<{ terms: { fee_pct?: number } }>(
      "SELECT terms FROM contracts WHERE brand_id=$1 AND status='signed' ORDER BY created_at DESC LIMIT 1", [c.brand_id])
      .catch(() => null);
    const feePct = contract?.terms?.fee_pct ?? 10;

    // 구독분(수기 결제 해당 월)
    const sub = await queryOne<{ s: string }>(
      "SELECT COALESCE(sum(amount),0)::text s FROM payments_manual WHERE brand_id=$1 AND date_trunc('month',paid_at)=$2",
      [c.brand_id, month]).catch(() => ({ s: "0" }));

    // 실 GMV ← 이번 사이클 lives.gmv 합계 (조회 실패 시 0 방어).
    const gmvRow = await queryOne<{ g: string }>(
      "SELECT COALESCE(sum(gmv),0)::text g FROM lives WHERE cycle_id=$1", [c.id])
      .catch(() => ({ g: "0" }));
    const gmv = Number(gmvRow?.g ?? 0);

    // 검증용 est_gmv ← 최신 brand_signals (없거나 실패 시 null → anomaly 미판정).
    const estRow = await queryOne<{ v: string | null }>(
      `SELECT value_num::text v FROM brand_signals
        WHERE brand_id=$1 AND metric='est_gmv'
        ORDER BY collected_at DESC LIMIT 1`, [c.brand_id]).catch(() => null);
    const estGmv = estRow?.v != null ? Number(estRow.v) : null;

    const calc = computeSettlement({ gmv, feePct, subAmount: Number(sub?.s ?? 0), estGmv });
    await query(
      `INSERT INTO settlements (brand_id, month, gmv, fee_pct, fee_amount, sub_amount, total, anomaly, anomaly_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [c.brand_id, month, calc.gmv, calc.feePct, calc.feeAmount, calc.subAmount, calc.total, calc.anomaly, calc.anomalyNote]);
    settlements++;
  }
  return { closed, settlements };
}

// ── 시딩 추천 (15 §3-1, glovek creators 읽기전용) ──────────────
export interface CreatorSuggestion { handle: string; avg_views: number | null; score: number; reason: string }
export async function suggestCreators(brandCategory: string, country = "US", limit = 20): Promise<CreatorSuggestion[]> {
  try {
    const rows = await queryRo<{ handle: string; avg_views: number | null; category: string | null }>(
      `SELECT handle, avg_views, category FROM creators
        WHERE (category=$1 OR $1='') AND (country=$2 OR country IS NULL)
        ORDER BY avg_views DESC NULLS LAST LIMIT $3`, [brandCategory, country, limit]);
    return rows.map((r) => ({
      handle: r.handle, avg_views: r.avg_views,
      score: Math.round((r.avg_views ?? 0) / 1000) + (r.category === brandCategory ? 10 : 0),
      reason: `${r.category ?? "?"} · 평균조회 ${(r.avg_views ?? 0).toLocaleString()}`,
    }));
  } catch {
    return []; // creators 미연동
  }
}

// ── 조회 (화면) ────────────────────────────────────────────────
export interface CycleRow {
  id: string; brand_id: string; brand_name: string; month: string; plan: string;
  status: string; items_total: number; items_done: number; target_total: number; rate: number;
}
export async function opsDashboard(month = monthFirst()): Promise<CycleRow[]> {
  return query<CycleRow>(
    `SELECT c.id, c.brand_id, b.brand_name, c.month, c.plan, c.status, c.items_total,
            COALESCE(sum(wi.qty_done),0)::int items_done,
            COALESCE(sum(wi.qty_target),0)::int target_total,
            CASE WHEN COALESCE(sum(wi.qty_target),0)=0 THEN 0
                 ELSE round(COALESCE(sum(wi.qty_done),0)::numeric/sum(wi.qty_target)*100) END AS rate
       FROM ops_cycles c JOIN brands b ON b.id=c.brand_id
       LEFT JOIN work_items wi ON wi.cycle_id=c.id
      WHERE c.month=$1
      GROUP BY c.id, b.brand_name ORDER BY rate ASC`, [month]);
}

export interface WorkItemRow {
  id: string; cycle_id: string; kind: string; qty_target: number; qty_done: number; status: string;
}
/** 월 사이클들의 워크아이템 — 진척 입력 UI 용. */
export async function workItemsForCycles(cycleIds: string[]): Promise<Record<string, WorkItemRow[]>> {
  if (cycleIds.length === 0) return {};
  const rows = await query<WorkItemRow>(
    "SELECT id, cycle_id, kind, qty_target, qty_done, status FROM work_items WHERE cycle_id = ANY($1) ORDER BY kind",
    [cycleIds]).catch(() => []);
  const map: Record<string, WorkItemRow[]> = {};
  for (const r of rows) (map[r.cycle_id] ??= []).push(r);
  return map;
}
