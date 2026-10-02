// 틱톡샵 주간 온보딩 신청 — 저장·조회.
//   이 파일에는 고객에게 보내는 경로가 없다. 받아서 저장하고 직원이 보는 것까지만 한다.
//
//   일부러 하지 않는 것
//     · brands 를 만들거나 기존 고객 값을 고치지 않는다.
//     · 자동 문자·메일 캠페인에 등록하지 않는다(processIngest 를 거치지 않는다).
//     · 선착순 확정·자동 마감 판정을 하지 않는다.
import { query, queryOne } from "./db";
import {
  WEEKLY_SOURCE, WEEKLY_STATUSES, WEEKLY_STATUS_LABEL,
  EMAIL_RE, cleanText as clean, normEmail, normPhone, normSite, weekKey,
  REVENUE_BANDS, REVENUE_KEYS, isRevenueBand, revenueLabel,
  type WeeklyStatus, type RevenueBand,
} from "./weekly-onboarding-model";

// 순수 값은 모델 모듈에 있다(클라이언트가 pg 를 끌고 오지 않도록). 여기서 다시 내보낸다.
export {
  WEEKLY_SOURCE, WEEKLY_STATUSES, WEEKLY_STATUS_LABEL,
  EMAIL_RE, normEmail, normPhone, normSite, weekKey,
  REVENUE_BANDS, REVENUE_KEYS, isRevenueBand, revenueLabel,
};
export type { WeeklyStatus, RevenueBand };

export const WEEKLY_SCHEMA_MIGRATION = "0107_weekly_onboarding_apply.sql";
/** 자가 기입 매출 구간 컬럼을 더하는 마이그레이션. 미적용이어도 제출·목록은 그대로 동작한다. */
export const WEEKLY_REVENUE_MIGRATION = "0108_weekly_onb_revenue.sql";

/**
 * revenue_band 컬럼이 실제로 있는지 — 0108 미적용 DB 에서도 접수가 깨지지 않게 분기한다.
 *   한 프로세스에서 한 번만 확인하고, 없다고 나오면 다음 요청에서 다시 본다(적용 직후 반영되게).
 */
let revenueColCache: boolean | null = null;
/** 컬럼이 사라졌거나 새로 생겼을 때 다음 호출이 다시 확인하게 한다. */
function forgetRevenueColumn(): void { revenueColCache = null; }
/** 실행 중 컬럼이 없어진 경우(롤백 등)를 알리는 오류인지. */
function isMissingRevenueColumn(e: unknown): boolean {
  return /revenue_band/.test((e as Error)?.message ?? "") && /does not exist|존재하지/.test((e as Error)?.message ?? "");
}
export async function hasRevenueColumn(): Promise<boolean> {
  if (revenueColCache !== null) return revenueColCache;
  try {
    const rows = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='weekly_onb_applications'
          AND column_name='revenue_band'`);
    revenueColCache = rows.length > 0;
    return revenueColCache;
  } catch {
    return false;
  }
}

export interface WeeklySchemaState {
  ready: boolean; missing: string[]; error?: string;
  /** 매출 구간 컬럼(0108) 적용 여부. false 면 새 신청의 매출 구간이 저장되지 않는다. */
  revenueReady: boolean;
  revenueMigration: string;
}
export async function weeklySchemaState(): Promise<WeeklySchemaState> {
  const need = ["weekly_onb_applications", "weekly_onb_events"];
  try {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`, [need]);
    const have = new Set(rows.map((r) => r.table_name));
    const ready = need.every((t) => have.has(t));
    return {
      ready, missing: need.filter((t) => !have.has(t)),
      // 적용 직후 화면이 바로 바뀌도록 캐시를 비우고 실제를 본다.
      revenueReady: ready ? (forgetRevenueColumn(), await hasRevenueColumn()) : false,
      revenueMigration: WEEKLY_REVENUE_MIGRATION,
    };
  } catch (e) {
    return {
      ready: false, missing: need, error: (e as Error).message.slice(0, 200),
      revenueReady: false, revenueMigration: WEEKLY_REVENUE_MIGRATION,
    };
  }
}

export interface WeeklyApplyInput {
  brandName: string; companyName: string; siteUrl?: string;
  contactName: string; contactTitle?: string;
  phone: string; email: string; note?: string;
  /** 신청자가 고른 자가 기입 매출 구간(필수). 브랜드 원장 매출과 별개 값이다. */
  revenueBand?: string;
  /** 검수용 합성 데이터에만 쓴다. 공개 폼에서는 넘어오지 않는다. */
  isTest?: boolean;
}

export interface WeeklyApplyResult {
  ok: boolean;
  error?: string;
  /** 같은 주에 이미 접수된 신청이면 true — 새로 만들지 않는다. */
  already?: boolean;
  id?: string;
  /** 0108 미적용이라 매출 구간을 저장하지 못했으면 true(접수 자체는 정상). */
  revenueNotStored?: boolean;
}

/** 공개 폼 제출 저장. 같은 사람이 같은 주에 여러 번 눌러도 1건만 남는다. */
export async function submitWeeklyApplication(input: WeeklyApplyInput, now = new Date()): Promise<WeeklyApplyResult> {
  const brandName = clean(input.brandName, 120);
  const companyName = clean(input.companyName, 120);
  const contactName = clean(input.contactName, 60);
  const contactTitle = clean(input.contactTitle, 60);
  const email = normEmail(input.email);
  const phone = normPhone(input.phone);
  const site = normSite(input.siteUrl);

  if (!brandName) return { ok: false, error: "브랜드명을 입력해주세요." };
  if (!companyName) return { ok: false, error: "회사명을 입력해주세요." };
  if (!contactName) return { ok: false, error: "담당자명을 입력해주세요." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "이메일 형식을 확인해주세요." };
  if (phone.length < 9) return { ok: false, error: "연락처를 정확히 입력해주세요." };
  if (!site.ok) return { ok: false, error: "사이트 주소 형식을 확인해주세요(예: brand.co.kr)." };
  // 매출 구간은 필수이고, 목록에 있는 값만 받는다(화면에서 온 임의 문자열을 그대로 쓰지 않는다).
  if (!isRevenueBand(input.revenueBand)) return { ok: false, error: "현재 브랜드 매출액을 선택해주세요." };
  const revenue = input.revenueBand as RevenueBand;

  const wk = weekKey(now);
  const dedupe = `${email}|${phone}`;

  // 0108 미적용 DB 에서도 접수가 깨지지 않게, 컬럼이 있을 때만 함께 저장한다.
  const withRevenue = await hasRevenueColumn();
  const cols = ["brand_name", "company_name", "site_url", "contact_name", "contact_title",
    "phone", "email", "note", "week_key", "dedupe_key", "source", "is_test"];
  const vals: unknown[] = [brandName, companyName, site.value, contactName, contactTitle, phone, email,
    clean(input.note, 1000), wk, dedupe, WEEKLY_SOURCE, Boolean(input.isTest)];
  if (withRevenue) { cols.push("revenue_band"); vals.push(revenue); }
  const ph = vals.map((_, i) => `$${i + 1}`).join(",");
  // 같은 주 재제출이면 매출 구간만 최신 선택으로 갱신한다(다른 값·연락 상태는 건드리지 않는다).
  const onConflict = withRevenue
    ? "DO UPDATE SET revenue_band = EXCLUDED.revenue_band, updated_at = now()"
    : "DO UPDATE SET updated_at = now()";

  const insert = async (useRevenue: boolean) => {
    const c = useRevenue ? cols : cols.filter((x) => x !== "revenue_band");
    const v = useRevenue ? vals : vals.slice(0, cols.indexOf("revenue_band") >= 0 ? cols.indexOf("revenue_band") : vals.length);
    const placeholders = v.map((_, i) => `$${i + 1}`).join(",");
    const conflict = useRevenue
      ? "DO UPDATE SET revenue_band = EXCLUDED.revenue_band, updated_at = now()"
      : "DO UPDATE SET updated_at = now()";
    return queryOne<{ id: string; inserted: boolean }>(
      `INSERT INTO weekly_onb_applications (${c.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (dedupe_key, week_key) ${conflict}
       RETURNING id, (xmax = 0) AS inserted`, v);
  };

  try {
    let used = withRevenue;
    let r: { id: string; inserted: boolean } | null;
    try {
      r = await insert(withRevenue);
    } catch (e) {
      // 프로브 이후 컬럼이 사라졌어도 접수를 떨어뜨리지 않는다(캐시를 비우고 컬럼 없이 재시도).
      if (withRevenue && isMissingRevenueColumn(e)) {
        forgetRevenueColumn();
        used = false;
        r = await insert(false);
      } else throw e;
    }
    if (!r) return { ok: false, error: "접수에 실패했습니다. 잠시 후 다시 시도해주세요." };
    return { ok: true, id: r.id, already: !r.inserted, revenueNotStored: !used };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/weekly_onb_applications/.test(msg) && /does not exist/.test(msg)) {
      return { ok: false, error: "접수 준비가 아직 끝나지 않았습니다. 잠시 후 다시 시도해주세요." };
    }
    return { ok: false, error: "접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }
}

// ── 관리자 조회 ─────────────────────────────────────────────
export interface WeeklyRow {
  id: string;
  brand_name: string; company_name: string; site_url: string;
  contact_name: string; contact_title: string; phone: string; email: string;
  note: string; week_key: string; status: WeeklyStatus;
  owner_admin_id: string | null; admin_note: string;
  /** 신청자가 고른 자가 기입 매출 구간. 기존 신청·0108 미적용이면 null(미기입). */
  revenue_band: string | null;
  is_test: boolean; created_at: string; updated_at: string;
}
const COLS = `id, brand_name, company_name, site_url, contact_name, contact_title, phone, email,
  note, week_key::text AS week_key, status, owner_admin_id, admin_note, is_test,
  created_at::text AS created_at, updated_at::text AS updated_at`;

export async function listWeeklyApplications(opts: { includeTest?: boolean; limit?: number } = {}): Promise<WeeklyRow[]> {
  const cond = opts.includeTest ? "" : "WHERE is_test = false";
  // 0108 미적용이면 매출 컬럼 없이 조회한다 — 목록이 깨지지 않게.
  const limit = Math.min(500, opts.limit ?? 200);
  const run = (rev: string) => query<WeeklyRow>(
    `SELECT ${COLS}, ${rev} FROM weekly_onb_applications ${cond}
      ORDER BY created_at DESC LIMIT $1`, [limit]);
  if (!(await hasRevenueColumn())) return run("NULL::text AS revenue_band");
  try {
    return await run("revenue_band");
  } catch (e) {
    if (!isMissingRevenueColumn(e)) throw e;
    forgetRevenueColumn();
    return run("NULL::text AS revenue_band");
  }
}

export interface WeeklyCounts { week: string; total: number; byStatus: Record<string, number> }
/** 이번 주 접수 현황 — 직원용 집계다. 공개 화면에서 잔여석으로 쓰지 않는다. */
export async function weeklyCounts(now = new Date()): Promise<WeeklyCounts> {
  const wk = weekKey(now);
  const rows = await query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM weekly_onb_applications
      WHERE week_key = $1 AND is_test = false GROUP BY status`, [wk]);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { byStatus[r.status] = Number(r.n); total += Number(r.n); }
  return { week: wk, total, byStatus };
}

export async function setWeeklyStatus(id: string, status: string, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  if (!(WEEKLY_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "알 수 없는 상태입니다." };
  const before = await queryOne<{ status: string }>(
    "SELECT status FROM weekly_onb_applications WHERE id=$1::uuid", [id]);
  if (!before) return { ok: false, error: "신청을 찾지 못했습니다." };
  await query("UPDATE weekly_onb_applications SET status=$2, updated_at=now() WHERE id=$1::uuid", [id, status]);
  await query(
    "INSERT INTO weekly_onb_events (application_id, field, old_value, new_value, actor) VALUES ($1::uuid,$2,$3,$4,$5)",
    [id, "status", before.status, status, actor]).catch(() => {});
  return { ok: true };
}

export async function setWeeklyOwner(id: string, owner: string | null, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const who = (owner ?? "").trim().toLowerCase() || null;
  if (who) {
    const u = await queryOne<{ id: string }>("SELECT id FROM admin_users WHERE id=$1 AND active", [who]);
    if (!u) return { ok: false, error: "등록된 활성 담당자가 아닙니다." };
  }
  const r = await query<{ id: string }>(
    "UPDATE weekly_onb_applications SET owner_admin_id=$2, updated_at=now() WHERE id=$1::uuid RETURNING id",
    [id, who]);
  if (r.length === 0) return { ok: false, error: "신청을 찾지 못했습니다." };
  await query(
    "INSERT INTO weekly_onb_events (application_id, field, old_value, new_value, actor) VALUES ($1::uuid,$2,$3,$4,$5)",
    [id, "owner", "", who ?? "(해제)", actor]).catch(() => {});
  return { ok: true };
}

export async function setWeeklyNote(id: string, note: string, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ id: string }>(
    "UPDATE weekly_onb_applications SET admin_note=$2, updated_at=now() WHERE id=$1::uuid RETURNING id",
    [id, clean(note, 2000)]);
  if (r.length === 0) return { ok: false, error: "신청을 찾지 못했습니다." };
  await query(
    "INSERT INTO weekly_onb_events (application_id, field, old_value, new_value, actor) VALUES ($1::uuid,$2,$3,$4,$5)",
    [id, "note", "", clean(note, 200), actor]).catch(() => {});
  return { ok: true };
}

/** 검수용 합성 데이터만 지운다 — 실제 신청은 이 경로로 지워지지 않는다. */
export async function deleteWeeklyTestRows(): Promise<{ deleted: number }> {
  const r = await query<{ id: string }>(
    "DELETE FROM weekly_onb_applications WHERE is_test = true RETURNING id");
  return { deleted: r.length };
}
