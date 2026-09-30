// 담당자별 내부 PM 안내(긴급·일간·주간).
//   · 수신자는 admin_users 뿐이다 — 이 경로로 브랜드사(고객)에게는 아무것도 나가지 않는다.
//   · 기본 OFF. 수신자 목록이 비어 있으면 어떤 경우에도 보내지 않는다.
//   · 같은 종류 · 같은 수신자 · 같은 기간은 1건만(pm_notify_log 유니크).
//   · 담당자에게는 자기가 배정된 브랜드만 담는다(권한 유지).
//   · 메시지에 도구·모델 이름이나 "sent using ..." 같은 문구를 넣지 않는다.
import { query, queryOne } from "./db";
import { BRAND_OWNER_COLUMNS } from "./pm-access";
import { taskBuckets, kstDay, WAITING_LABEL, type BriefTask } from "./pm-brief";

export const PM_NOTIFY_KINDS = ["urgent", "daily", "weekly"] as const;
export type PmNotifyKind = (typeof PM_NOTIFY_KINDS)[number];

export interface PmNotifyConfig {
  enabled: boolean;
  urgentEnabled: boolean; dailyEnabled: boolean; weeklyEnabled: boolean;
  dailyHour: number; dailyMinute: number;
  weeklyWeekday: number; weeklyHour: number; weeklyMinute: number;
  recipients: string[];
  note: string;
  updatedBy: string | null; updatedAt: string | null;
}

interface CfgRow {
  enabled: boolean; urgent_enabled: boolean; daily_enabled: boolean; weekly_enabled: boolean;
  daily_hour: number; daily_minute: number;
  weekly_weekday: number; weekly_hour: number; weekly_minute: number;
  recipients: string[]; note: string; updated_by: string | null; updated_at: string | null;
}

export async function getPmNotifyConfig(): Promise<PmNotifyConfig> {
  const r = await queryOne<CfgRow>(
    `SELECT enabled, urgent_enabled, daily_enabled, weekly_enabled,
            daily_hour, daily_minute, weekly_weekday, weekly_hour, weekly_minute,
            recipients, note, updated_by, updated_at::text AS updated_at
       FROM pm_notify_config WHERE id=1`);
  if (!r) throw new Error("PM 알림 설정 행이 없습니다 — 마이그레이션 0104_pm_v2.sql 적용이 필요합니다.");
  return {
    enabled: r.enabled, urgentEnabled: r.urgent_enabled, dailyEnabled: r.daily_enabled,
    weeklyEnabled: r.weekly_enabled,
    dailyHour: r.daily_hour, dailyMinute: r.daily_minute,
    weeklyWeekday: r.weekly_weekday, weeklyHour: r.weekly_hour, weeklyMinute: r.weekly_minute,
    recipients: r.recipients ?? [], note: r.note ?? "",
    updatedBy: r.updated_by, updatedAt: r.updated_at,
  };
}

export interface NotifyPatch {
  enabled?: boolean; urgentEnabled?: boolean; dailyEnabled?: boolean; weeklyEnabled?: boolean;
  dailyHour?: number; dailyMinute?: number;
  weeklyWeekday?: number; weeklyHour?: number; weeklyMinute?: number;
  recipients?: string[]; note?: string;
}
const COL: Record<keyof NotifyPatch, string> = {
  enabled: "enabled", urgentEnabled: "urgent_enabled", dailyEnabled: "daily_enabled",
  weeklyEnabled: "weekly_enabled", dailyHour: "daily_hour", dailyMinute: "daily_minute",
  weeklyWeekday: "weekly_weekday", weeklyHour: "weekly_hour", weeklyMinute: "weekly_minute",
  recipients: "recipients", note: "note",
};

export async function updatePmNotifyConfig(patch: NotifyPatch, by: string): Promise<{ ok: boolean; error?: string }> {
  if (patch.recipients !== undefined) {
    const ids = [...new Set(patch.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
    // 수신자는 실제 활성 어드민만 — 고객 주소가 들어가지 않게 DB 로 확인한다.
    if (ids.length) {
      const rows = await query<{ id: string }>(
        "SELECT id FROM admin_users WHERE id = ANY($1::text[]) AND active", [ids]);
      const ok = new Set(rows.map((r) => r.id.toLowerCase()));
      const bad = ids.filter((i) => !ok.has(i));
      if (bad.length) return { ok: false, error: `등록된 활성 담당자가 아닙니다: ${bad.join(", ")}` };
    }
    patch = { ...patch, recipients: ids };
  }
  // 수신자 없이 켤 수 없다 — 받는 사람이 정해지기 전에는 발송 OFF 를 유지한다.
  if (patch.enabled === true) {
    const cur = await getPmNotifyConfig();
    const list = patch.recipients ?? cur.recipients;
    if (list.length === 0) return { ok: false, error: "수신자를 먼저 지정해야 내부 알림을 켤 수 있습니다." };
  }
  const set: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const col = COL[k as keyof NotifyPatch];
    if (!col) continue;
    args.push(v);
    set.push(`${col}=$${args.length}`);
  }
  if (set.length === 0) return { ok: true };
  args.push(by);
  await query(`UPDATE pm_notify_config SET ${set.join(", ")}, updated_by=$${args.length}, updated_at=now() WHERE id=1`, args);
  return { ok: true };
}

// ── 담당자 몫 모으기 ────────────────────────────────────────
export interface RecipientDigest {
  recipient: string;
  brands: { brandId: string; brandName: string; overdue: BriefTask[]; today: BriefTask[]; waiting: BriefTask[] }[];
  itemCount: number;
}

/**
 * 담당자가 볼 수 있는 브랜드만 모은다 — 배정 담당(owner_*) 또는 PM 담당.
 *   테스트 브랜드와 PM 이 꺼진 브랜드는 담지 않는다.
 */
export async function digestFor(recipient: string, today = kstDay()): Promise<RecipientDigest> {
  const me = recipient.trim().toLowerCase();
  const ownerCond = BRAND_OWNER_COLUMNS.map((c) => `lower(coalesce(b.${c},'')) = $1`).join(" OR ");
  const rows = await query<{
    brand_id: string; brand_name: string; id: string; kind: string; title: string;
    priority: number; owner_admin_id: string | null; due_date: string | null;
    status: string; waiting_on: string; origin: string; confirmed_by: string | null; kpi_id: string | null;
  }>(
    `SELECT b.id AS brand_id, b.brand_name, t.id, t.kind, t.title, t.priority,
            t.owner_admin_id, t.due_date::text AS due_date, t.status, t.waiting_on,
            t.origin, t.confirmed_by, t.kpi_id::text AS kpi_id
       FROM pm_tasks t
       JOIN brands b ON b.id = t.brand_id
       JOIN pm_brand_config p ON p.brand_id = b.id AND p.enabled
      WHERE coalesce(b.is_test,false) = false
        AND t.status IN ('open','doing','reopened')
        AND (${ownerCond} OR lower(coalesce(p.owner_admin_id,'')) = $1)
      ORDER BY b.brand_name, t.priority, t.due_date NULLS LAST`, [me]);

  const byBrand = new Map<string, { brandId: string; brandName: string; tasks: BriefTask[] }>();
  for (const r of rows) {
    if (!byBrand.has(r.brand_id)) byBrand.set(r.brand_id, { brandId: r.brand_id, brandName: r.brand_name, tasks: [] });
    byBrand.get(r.brand_id)!.tasks.push({
      id: r.id, kind: r.kind, title: r.title, priority: r.priority, owner: r.owner_admin_id,
      dueDate: r.due_date, status: r.status, waitingOn: r.waiting_on ?? "none",
      origin: r.origin, confirmedBy: r.confirmed_by, kpiId: r.kpi_id,
    });
  }
  const brands = [...byBrand.values()].map((b) => {
    const k = taskBuckets(b.tasks, today);
    return {
      brandId: b.brandId, brandName: b.brandName,
      overdue: k.overdue, today: k.today,
      waiting: [...k.waitingCustomer, ...k.waitingInternal],
    };
  }).filter((b) => b.overdue.length || b.today.length || b.waiting.length);

  return {
    recipient: me, brands,
    itemCount: brands.reduce((n, b) => n + b.overdue.length + b.today.length + b.waiting.length, 0),
  };
}

/** 내부 안내 본문. 도구·모델 이름을 적지 않는다. */
export function renderDigest(kind: PmNotifyKind, d: RecipientDigest, today = kstDay()): string {
  const head = kind === "daily" ? `PM 일간 안내 (${today})`
    : kind === "weekly" ? `PM 주간 안내 (${today} 기준)`
    : `PM 긴급 안내 (${today})`;
  const lines: string[] = [`*${head}* — 내부 공유용`];
  if (d.brands.length === 0) {
    lines.push("담당 브랜드에 지금 처리할 항목이 없습니다.");
    return lines.join("\n");
  }
  for (const b of d.brands) {
    lines.push(`\n*${b.brandName}*`);
    for (const t of b.overdue) lines.push(`• 🔴 지연(${t.dueDate}) ${t.title}`);
    for (const t of b.today) lines.push(`• 🟠 오늘 ${t.title}`);
    for (const t of b.waiting) lines.push(`• ⏳ ${WAITING_LABEL[t.waitingOn] ?? t.waitingOn} ${t.title}`);
  }
  lines.push(`\n기준 시각 ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · 항목 ${d.itemCount}건`);
  return lines.join("\n");
}

export function periodKeyFor(kind: PmNotifyKind, today = kstDay(), ref = ""): string {
  if (kind === "urgent") return `u:${ref}`;
  if (kind === "daily") return `d:${today}`;
  const t = Date.parse(`${today}T00:00:00Z`);
  const dow = new Date(t).getUTCDay();
  const monday = new Date(t - ((dow === 0 ? 6 : dow - 1) * 86400_000)).toISOString().slice(0, 10);
  return `w:${monday}`;
}

export interface NotifyRunResult {
  ok: boolean; error?: string;
  kind: PmNotifyKind;
  recipients: number; sent: number; skipped: number; failed: number; duplicate: number;
  blocked: string[];
}

/**
 * 담당자별 안내를 보낸다.
 *   설정이 꺼져 있거나 수신자가 없으면 아무것도 보내지 않고 사유만 돌려준다.
 *   dryRun 이면 원장에 'skipped(미리보기)' 로 남기고 실제 전송은 하지 않는다.
 */
export async function runPmNotify(kind: PmNotifyKind, opts: { dryRun?: boolean; today?: string } = {}):
  Promise<NotifyRunResult> {
  const today = opts.today ?? kstDay();
  const base: NotifyRunResult = { ok: true, kind, recipients: 0, sent: 0, skipped: 0, failed: 0, duplicate: 0, blocked: [] };
  let cfg: PmNotifyConfig;
  try { cfg = await getPmNotifyConfig(); }
  catch (e) { return { ...base, ok: false, error: (e as Error).message.slice(0, 200) }; }

  const kindOn = kind === "urgent" ? cfg.urgentEnabled : kind === "daily" ? cfg.dailyEnabled : cfg.weeklyEnabled;
  if (!cfg.enabled) base.blocked.push("내부 알림 마스터 스위치가 꺼져 있습니다");
  if (!kindOn) base.blocked.push(`${kind === "urgent" ? "긴급" : kind === "daily" ? "일간" : "주간"} 안내가 꺼져 있습니다`);
  if (cfg.recipients.length === 0) base.blocked.push("수신자가 지정되지 않았습니다");
  const dryRun = Boolean(opts.dryRun) || base.blocked.length > 0;

  base.recipients = cfg.recipients.length;
  for (const r of cfg.recipients) {
    const d = await digestFor(r, today).catch(() => null);
    if (!d) { base.failed += 1; continue; }
    if (d.itemCount === 0) { base.skipped += 1; continue; }
    const body = renderDigest(kind, d, today);
    const periodKey = periodKeyFor(kind, today, r);

    // 원장 선점 — 같은 기간 같은 수신자는 한 번만.
    const row = await queryOne<{ id: string }>(
      `INSERT INTO pm_notify_log (kind, recipient, period_key, brand_count, item_count, body_preview, status)
       VALUES ($1,$2,$3,$4,$5,$6,'queued')
       ON CONFLICT (kind, recipient, period_key) DO NOTHING
       RETURNING id`,
      [kind, r, periodKey, d.brands.length, d.itemCount, body.slice(0, 2000)]).catch(() => null);
    if (!row) { base.duplicate += 1; continue; }

    if (dryRun) {
      await query(
        "UPDATE pm_notify_log SET status='skipped', skip_reason=$2 WHERE id=$1",
        [row.id, base.blocked.length ? base.blocked.join(" · ").slice(0, 300) : "미리보기 — 실제 발송하지 않음"]);
      base.skipped += 1;
      continue;
    }

    try {
      const { slackPostDM } = await import("./slack");
      await slackPostDM(r, { text: body });
      await query("UPDATE pm_notify_log SET status='sent', sent_at=now(), channel='slack' WHERE id=$1", [row.id]);
      base.sent += 1;
    } catch (e) {
      await query("UPDATE pm_notify_log SET status='failed', error=$2 WHERE id=$1",
        [row.id, (e as Error).message.slice(0, 300)]);
      base.failed += 1;
    }
  }
  return base;
}

export interface NotifyLogRow {
  id: string; kind: string; recipient: string; period_key: string;
  brand_count: number; item_count: number; status: string; channel: string;
  error: string; skip_reason: string; created_at: string; sent_at: string | null;
}
export async function listPmNotifyLog(limit = 30): Promise<NotifyLogRow[]> {
  return query<NotifyLogRow>(
    `SELECT id, kind, recipient, period_key, brand_count, item_count, status, channel,
            error, skip_reason, created_at::text AS created_at, sent_at::text AS sent_at
       FROM pm_notify_log ORDER BY created_at DESC LIMIT $1`, [limit]);
}
