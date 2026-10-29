// 원장 전체 → 기존 Google Sheet 자동 기록.
//
//   원칙
//     · 소스 DB 는 읽기 전용이다. 이 파일에서 brands 를 쓰지 않는다.
//     · 사람이 쓰는 칸(메모)과 우리가 모르는 열은 건드리지 않는다.
//     · 행을 지우지 않는다. 사라진 브랜드도 시트에서 없애지 않는다.
//     · 브랜드 ID 로 기존 행을 찾아 갱신한다. 시트를 정렬해도 안전하다.
//     · 실패하면 지난 성공을 지우지 않는다. 갱신기록은 성공한 뒤에만 쓴다.
//     · 로그에 연락처·매출·토큰을 남기지 않는다.
import { query, queryOne, queryRo } from "./db";
import { env } from "./env";
import { STATE_LABELS, SOURCE_LABELS, PLAN_LABELS } from "./types";
import { connectSheets, sheetsAuthState, type SheetsClient } from "./google-sheets";
import {
  buildRow, MANAGED_HEADERS, PROTECTED_HEADERS, ID_HEADER, dateCell,
  type LedgerBrand, type RowValues, type Cell,
} from "./ledger-sheet-rows";

export const SHEET_SYNC_MIGRATION = "0115_sheet_sync_runs.sql";

/** 헤더 5행, 데이터 6행부터. 기존 시트 구조에 맞춘 값이다. */
export const HEADER_ROW = 5;
export const FIRST_DATA_ROW = 6;

// ── 스키마 ───────────────────────────────────────────────────
export async function sheetSyncSchemaReady(): Promise<boolean> {
  const r = await queryOne<{ ok: boolean }>(
    "SELECT to_regclass('public.sheet_sync_runs') IS NOT NULL AS ok").catch(() => null);
  return Boolean(r?.ok);
}

// ── 원장 읽기(읽기 전용) ─────────────────────────────────────
//   커뮤니케이션은 email_messages(Gmail 수집) 와 brand_emails(수기·연동 기록)를
//   모두 본다. UI 가 최근 200스레드만 보던 것과 달리 브랜드별 전체를 집계한다.
const LEDGER_SQL = `
WITH msg AS (
  SELECT brand_id,
         max(sent_at) FILTER (WHERE direction='out') AS last_out,
         max(sent_at) FILTER (WHERE direction='in')  AS last_in,
         count(*)                                     AS total
    FROM email_messages GROUP BY brand_id
),
msg_out AS (
  SELECT DISTINCT ON (m.brand_id) m.brand_id, m.subject
    FROM email_messages m JOIN msg ON msg.brand_id=m.brand_id AND msg.last_out=m.sent_at
   WHERE m.direction='out' ORDER BY m.brand_id, m.sent_at DESC
),
msg_in AS (
  SELECT DISTINCT ON (m.brand_id) m.brand_id, m.subject
    FROM email_messages m JOIN msg ON msg.brand_id=m.brand_id AND msg.last_in=m.sent_at
   WHERE m.direction='in' ORDER BY m.brand_id, m.sent_at DESC
),
be AS (
  SELECT brand_id,
         max(occurred_at) FILTER (WHERE direction='out') AS last_out,
         max(occurred_at) FILTER (WHERE direction='in')  AS last_in,
         max(occurred_at)                                AS last_any,
         count(*)                                        AS total
    FROM brand_emails GROUP BY brand_id
),
-- 고객이 신청서에서 직접 고른 매출 구간. 이메일 정규화 정확일치로만 잇는다.
--   추측 매칭을 하지 않는다 — 틀리면 남의 매출이 붙는다.
rep AS (
  SELECT DISTINCT ON (lower(btrim(w.email)))
         lower(btrim(w.email)) AS email_norm,
         w.revenue_band, w.created_at, 'weekly 신청서' AS src
    FROM weekly_onb_applications w
   WHERE coalesce(w.revenue_band,'') <> '' AND coalesce(w.is_test,false) = false
   ORDER BY lower(btrim(w.email)), w.created_at DESC
)
SELECT b.id::text AS id, b.brand_name, b.contact_name, b.phone, b.email,
       b.category, b.brand_url, b.state, b.source, b.plan, b.pay_status,
       coalesce(b.owner_sales, b.owner_intake, b.owner_onboard, b.owner_ads) AS owner_id,
       b.created_at::text AS created_at, b.updated_at::text AS updated_at,
       coalesce(b.msg_opt_out,false) AS msg_opt_out,
       coalesce(b.archived,false) AS archived,
       b.hold_kind, b.revenue_estimate,
       rep.revenue_band AS reported_band, rep.src AS reported_source,
       rep.created_at::text AS reported_at,
       greatest(msg.last_out, be.last_out)::text AS last_out_at,
       greatest(msg.last_in,  be.last_in)::text  AS last_in_at,
       be.last_any::text                          AS last_manual_at,
       (coalesce(msg.total,0) + coalesce(be.total,0))::int AS total_messages,
       msg_out.subject AS last_out_subject,
       msg_in.subject  AS last_in_subject
  FROM brands b
  LEFT JOIN msg     ON msg.brand_id = b.id
  LEFT JOIN msg_out ON msg_out.brand_id = b.id
  LEFT JOIN msg_in  ON msg_in.brand_id = b.id
  LEFT JOIN be      ON be.brand_id = b.id
  LEFT JOIN rep     ON rep.email_norm = lower(btrim(coalesce(b.email,'')))
                   AND coalesce(b.email,'') <> ''
 WHERE coalesce(b.is_test,false) = false
 ORDER BY b.created_at NULLS LAST, b.id`;

interface LedgerSqlRow {
  id: string; brand_name: string | null; contact_name: string | null;
  phone: string | null; email: string | null; category: string | null;
  brand_url: string | null; state: string | null; source: string | null;
  plan: string | null; pay_status: string | null; owner_id: string | null;
  created_at: string | null; updated_at: string | null;
  msg_opt_out: boolean; archived: boolean; hold_kind: string | null;
  revenue_estimate: unknown;
  reported_band: string | null; reported_source: string | null; reported_at: string | null;
  last_out_at: string | null; last_in_at: string | null; last_manual_at: string | null;
  total_messages: number;
  last_out_subject: string | null; last_in_subject: string | null;
}

/** 담당자 id(=이메일) → 이름. 없으면 id 를 그대로 쓴다. */
async function ownerNames(): Promise<Map<string, string>> {
  const rows = await queryRo<{ id: string; name: string | null }>(
    "SELECT id, name FROM admin_users").catch(() => []);
  return new Map(rows.map((r) => [r.id, (r.name ?? "").trim() || r.id]));
}

export async function readLedger(): Promise<LedgerBrand[]> {
  const [rows, owners] = await Promise.all([
    queryRo<LedgerSqlRow>(LEDGER_SQL),
    ownerNames(),
  ]);
  const { revenueLabel } = await import("./weekly-onboarding-model");
  return rows.map((r) => ({
    id: r.id,
    brand_name: r.brand_name, contact_name: r.contact_name,
    phone: r.phone, email: r.email, category: r.category, brand_url: r.brand_url,
    state: r.state, source: r.source, plan: r.plan, pay_status: r.pay_status,
    owner_label: r.owner_id ? (owners.get(r.owner_id) ?? r.owner_id) : null,
    created_at: r.created_at, updated_at: r.updated_at,
    msg_opt_out: r.msg_opt_out, archived: r.archived, hold_kind: r.hold_kind,
    revenue_estimate: r.revenue_estimate,
    reported_band: r.reported_band,
    reported_band_label: r.reported_band ? revenueLabel(r.reported_band) : null,
    reported_source: r.reported_source,
    reported_at: r.reported_at,
    comms: {
      lastOutAt: r.last_out_at, lastOutSubject: r.last_out_subject,
      lastInAt: r.last_in_at, lastInSubject: r.last_in_subject,
      lastManualAt: r.last_manual_at,
      totalMessages: r.total_messages,
    },
  }));
}

// ── 열 좌표 ──────────────────────────────────────────────────
/** 0-based 열 번호 → A1 표기(A, B, ... Z, AA ...). */
export function colLetter(index: number): string {
  let n = index + 1, out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 헤더 행 → { 열 이름: 0-based 번호 }. 이름으로 찾으므로 열 순서가 바뀌어도 된다. */
export function headerIndex(header: string[]): Map<string, number> {
  const m = new Map<string, number>();
  header.forEach((h, i) => {
    const key = (h ?? "").trim();
    if (key && !m.has(key)) m.set(key, i);
  });
  return m;
}

/** 우리가 쓸 수 있는 열만 남긴다 — 보호 칸과 시트에 없는 열은 뺀다. */
export function writableHeaders(index: Map<string, number>): string[] {
  return MANAGED_HEADERS.filter((h) => index.has(h) && !PROTECTED_HEADERS.has(h));
}

/** 한 행에서 바꿀 칸들을 연속 구간으로 묶어 범위 수를 줄인다. */
export function rangesForRow(
  tab: string, rowNumber: number, values: RowValues,
  index: Map<string, number>, headers: string[],
): { range: string; values: unknown[][] }[] {
  const cells = headers
    .map((h) => ({ col: index.get(h)!, value: values[h] }))
    .filter((c) => c.value !== undefined)
    .sort((a, b) => a.col - b.col);
  if (cells.length === 0) return [];

  const out: { range: string; values: unknown[][] }[] = [];
  let run: { start: number; vals: Cell[] } | null = null;
  const flush = () => {
    if (!run) return;
    const a = `${colLetter(run.start)}${rowNumber}`;
    const b = `${colLetter(run.start + run.vals.length - 1)}${rowNumber}`;
    out.push({ range: `'${tab}'!${a}:${b}`, values: [run.vals] });
    run = null;
  };
  for (const c of cells) {
    if (run && c.col === run.start + run.vals.length) run.vals.push(c.value as Cell);
    else { flush(); run = { start: c.col, vals: [c.value as Cell] }; }
  }
  flush();
  return out;
}

// ── 실행 ─────────────────────────────────────────────────────
export interface SyncResult {
  ok: boolean;
  error?: string;
  /** 이번 실행이 claim 되지 않았다(같은 날 이미 실행). */
  skipped?: string;
  updated?: number;
  appended?: number;
  cells?: number;
  brands?: number;
  runId?: string;
}

/** KST 기준 YYYY-MM-DD. 하루 한 번 실행을 판정하는 키다. */
export function kstDateKey(now: Date): string {
  const k = new Date(now.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
}

export interface SyncOpts {
  now?: Date;
  /** 같은 날 다시 돌릴 때(수동 재시도). 기본은 하루 한 번만. */
  force?: boolean;
  /** 테스트용 주입. 없으면 실제 Sheets 에 연결한다. */
  client?: SheetsClient;
}

export async function syncLedgerToSheet(opts: SyncOpts = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const runDate = kstDateKey(now);

  const auth = sheetsAuthState();
  if (!opts.client && !auth.ready) return { ok: false, error: auth.reason };
  if (!(await sheetSyncSchemaReady())) {
    return { ok: false, error: `마이그레이션 ${SHEET_SYNC_MIGRATION} 미적용` };
  }

  const spreadsheetId = (env.sheets.ledgerSpreadsheetId ?? "").trim();
  const tab = (env.sheets.ledgerTab ?? "").trim();

  // 겹침 방지 + 멱등 — 같은 (시트, 날짜)를 INSERT 로 선점한다.
  //   두 실행이 동시에 들어오면 DB 가 한쪽만 통과시킨다.
  const claim = await queryOne<{ id: string; fresh: boolean }>(
    `INSERT INTO sheet_sync_runs (spreadsheet_id, run_date, status, started_at)
     VALUES ($1,$2,'running',now())
     ON CONFLICT (spreadsheet_id, run_date) DO UPDATE
       SET status='running', started_at=now(), attempts = sheet_sync_runs.attempts + 1
       WHERE sheet_sync_runs.status <> 'done' OR $3
     RETURNING id::text AS id, (xmax = 0) AS fresh`,
    [spreadsheetId || "(unset)", runDate, Boolean(opts.force)]).catch(() => null);

  if (!claim) {
    return { ok: true, skipped: `오늘(${runDate}) 이미 기록을 마쳤습니다.` };
  }
  const runId = claim.id;

  const fail = async (error: string): Promise<SyncResult> => {
    // 지난 성공 기록을 지우지 않는다 — 이번 실행 행만 실패로 닫는다.
    await query(
      "UPDATE sheet_sync_runs SET status='failed', error=$2, finished_at=now() WHERE id=$1::uuid",
      [runId, error.slice(0, 300)]).catch(() => {});
    return { ok: false, error, runId };
  };

  let client = opts.client;
  if (!client) {
    const conn = await connectSheets(spreadsheetId);
    if (!conn.ok) return fail(conn.error);
    client = conn.client;
  }

  try {
    const header = (await client.getValues(`'${tab}'!${HEADER_ROW}:${HEADER_ROW}`))[0] ?? [];
    const index = headerIndex(header.map((h) => String(h ?? "")));
    if (!index.has(ID_HEADER)) {
      return fail(`헤더 ${HEADER_ROW}행에서 '${ID_HEADER}' 열을 찾지 못했습니다.`);
    }
    const headers = writableHeaders(index);
    if (headers.length === 0) return fail("기록할 수 있는 열이 없습니다.");

    // 기존 행의 브랜드 ID → 행 번호. 정렬이 바뀌어도 ID 로 찾으므로 안전하다.
    const idCol = colLetter(index.get(ID_HEADER)!);
    const idVals = await client.getValues(`'${tab}'!${idCol}${FIRST_DATA_ROW}:${idCol}`);
    const rowOf = new Map<string, number>();
    idVals.forEach((r, i) => {
      const v = String(r?.[0] ?? "").trim();
      if (v && !rowOf.has(v)) rowOf.set(v, FIRST_DATA_ROW + i);
    });

    const brands = await readLedger();
    const collectedAt = now.toISOString();
    const o = {
      adminUrl: env.adminUrl,
      collectedAt,
      stateLabel: (s: string | null) => (s && STATE_LABELS[s as keyof typeof STATE_LABELS]) || s || "",
      sourceLabel: (s: string | null) => (s && SOURCE_LABELS[s]) || s || "",
      planLabel: (p: string | null, pay: string | null) => {
        const planName = (p && PLAN_LABELS[p as keyof typeof PLAN_LABELS]) || p || "";
        return [planName, pay && pay !== "none" ? pay : ""].filter(Boolean).join(" · ");
      },
    };

    const updates: { range: string; values: unknown[][] }[] = [];
    const appends: unknown[][] = [];
    let updated = 0;

    // 덧붙일 행은 헤더 전체 너비로 만들되, 보호 칸은 빈칸으로 둔다(사람이 나중에 쓴다).
    const width = header.length || Math.max(...[...index.values()]) + 1;

    for (const b of brands) {
      const values = buildRow(b, o);
      const row = rowOf.get(b.id);
      if (row) {
        updates.push(...rangesForRow(tab, row, values, index, headers));
        updated += 1;
      } else {
        const line = new Array<Cell>(width).fill("");
        for (const h of headers) line[index.get(h)!] = values[h] ?? "";
        appends.push(line);
      }
    }

    let cells = 0;
    // 한 번에 너무 많이 보내지 않는다 — 요청이 커지면 중간에서 끊긴다.
    for (let i = 0; i < updates.length; i += 500) {
      cells += await client.batchUpdate(updates.slice(i, i + 500));
    }
    let appended = 0;
    if (appends.length) {
      appended = await client.append(`'${tab}'!A${FIRST_DATA_ROW}`, appends);
    }

    await query(
      `UPDATE sheet_sync_runs
          SET status='done', finished_at=now(),
              brands=$2, updated_rows=$3, appended_rows=$4, error=''
        WHERE id=$1::uuid`,
      [runId, brands.length, updated, appended]).catch(() => {});

    // 갱신기록 탭은 성공한 뒤에만 쓴다. 실패한 실행이 기록으로 남지 않게.
    const logTab = (env.sheets.logTab ?? "").trim();
    if (logTab) {
      await client.append(`'${logTab}'!A1`, [[
        dateCell(collectedAt), runDate, brands.length, updated, appended, cells, "done",
      ]]).catch(() => {});   // 기록 실패가 본 작업을 되돌리지는 않는다
    }

    return { ok: true, brands: brands.length, updated, appended, cells, runId };
  } catch (e) {
    return fail((e as Error).message.slice(0, 300));
  }
}
