// 틱톡샵 주간 온보딩 신청 — 저장·조회.
//   이 파일에는 고객에게 보내는 경로가 없다. 받아서 저장하고 직원이 보는 것까지만 한다.
//
//   일부러 하지 않는 것
//     · brands 를 만들거나 기존 고객 값을 고치지 않는다.
//     · 자동 문자·메일 캠페인에 등록하지 않는다(processIngest 를 거치지 않는다).
//     · 선착순 확정·자동 마감 판정을 하지 않는다.
import { query, queryOne } from "./db";
import {
  WEEKLY_SLOTS, WEEKLY_SOURCE, WEEKLY_STATUSES, WEEKLY_STATUS_LABEL,
  EMAIL_RE, cleanText as clean, normEmail, normPhone, normSite, weekKey,
  type WeeklyStatus,
} from "./weekly-onboarding-model";

// 순수 값은 모델 모듈에 있다(클라이언트가 pg 를 끌고 오지 않도록). 여기서 다시 내보낸다.
export {
  WEEKLY_SLOTS, WEEKLY_SOURCE, WEEKLY_STATUSES, WEEKLY_STATUS_LABEL,
  EMAIL_RE, normEmail, normPhone, normSite, weekKey,
};
export type { WeeklyStatus };

export const WEEKLY_SCHEMA_MIGRATION = "0107_weekly_onboarding_apply.sql";

export async function weeklySchemaState(): Promise<{ ready: boolean; missing: string[]; error?: string }> {
  const need = ["weekly_onb_applications", "weekly_onb_events"];
  try {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`, [need]);
    const have = new Set(rows.map((r) => r.table_name));
    return { ready: need.every((t) => have.has(t)), missing: need.filter((t) => !have.has(t)) };
  } catch (e) {
    return { ready: false, missing: need, error: (e as Error).message.slice(0, 200) };
  }
}

export interface WeeklyApplyInput {
  brandName: string; companyName: string; siteUrl?: string;
  contactName: string; contactTitle?: string;
  phone: string; email: string; note?: string;
  /** 검수용 합성 데이터에만 쓴다. 공개 폼에서는 넘어오지 않는다. */
  isTest?: boolean;
}

export interface WeeklyApplyResult {
  ok: boolean;
  error?: string;
  /** 같은 주에 이미 접수된 신청이면 true — 새로 만들지 않는다. */
  already?: boolean;
  id?: string;
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

  const wk = weekKey(now);
  const dedupe = `${email}|${phone}`;

  try {
    const r = await queryOne<{ id: string; inserted: boolean }>(
      `INSERT INTO weekly_onb_applications
         (brand_name, company_name, site_url, contact_name, contact_title, phone, email, note,
          week_key, dedupe_key, source, is_test)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (dedupe_key, week_key) DO UPDATE SET updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [brandName, companyName, site.value, contactName, contactTitle, phone, email,
       clean(input.note, 1000), wk, dedupe, WEEKLY_SOURCE, Boolean(input.isTest)]);
    if (!r) return { ok: false, error: "접수에 실패했습니다. 잠시 후 다시 시도해주세요." };
    return { ok: true, id: r.id, already: !r.inserted };
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
  is_test: boolean; created_at: string; updated_at: string;
}
const COLS = `id, brand_name, company_name, site_url, contact_name, contact_title, phone, email,
  note, week_key::text AS week_key, status, owner_admin_id, admin_note, is_test,
  created_at::text AS created_at, updated_at::text AS updated_at`;

export async function listWeeklyApplications(opts: { includeTest?: boolean; limit?: number } = {}): Promise<WeeklyRow[]> {
  const cond = opts.includeTest ? "" : "WHERE is_test = false";
  return query<WeeklyRow>(
    `SELECT ${COLS} FROM weekly_onb_applications ${cond}
      ORDER BY created_at DESC LIMIT $1`, [Math.min(500, opts.limit ?? 200)]);
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
