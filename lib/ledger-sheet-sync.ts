// 원장 전체 → 기존 Google Sheet 자동 기록.
//
//   원칙
//     · 소스 DB 는 읽기 전용이다. 이 파일에서 brands 를 쓰지 않는다.
//     · 사람이 쓰는 칸(메모)과 우리가 모르는 열은 건드리지 않는다.
//     · 사람이 채워 둔 칸을 "미기록"으로 덮어쓰지 않는다. 시트의 기존 값을 먼저
//       읽고, 우리가 모르는 값일 때는 그 칸을 건너뛴다.
//     · 행을 지우지 않는다. 사라진 브랜드도 시트에서 없애지 않는다.
//     · 브랜드 ID 로 기존 행을 찾아 갱신한다. 시트를 정렬해도 안전하다.
//     · 쓰기 전에 멈출 것은 쓰기 전에 멈춘다 — 필수 열 누락, 같은 열 이름 중복,
//       시트 안의 브랜드 ID 중복.
//     · 쓴 뒤에는 다시 읽어 확인한다(readback). 확인되지 않으면 성공으로 표시하지 않는다.
//     · 실패하면 지난 성공을 지우지 않는다. 갱신기록은 성공한 뒤에만 쓴다.
//     · 삼키는 오류를 만들지 않는다. 부분 실패는 warnings 로 올린다.
//     · 로그에 연락처·매출·토큰을 남기지 않는다.
//
//   담는 범위(원장 전체)
//     brands 에서 is_test=true 만 제외한다. 수신거부·보류·보관·종료(dropped/
//     churned)까지 모두 싣고, 그 상태는 "상태표시" 열로 구분한다.
//     /customers 화면의 기본 total 과는 기준이 다르다 — 그 화면은 is_test 를
//     걸러내지 않고, 대신 dropped/churned 를 숨긴다. 두 숫자를 바로 비교하면
//     어긋나므로 ledgerScope() 가 양쪽 기준의 건수를 함께 돌려준다.
import { query, queryOne } from "./db";
import { env } from "./env";
import { STATE_LABELS, SOURCE_LABELS, PLAN_LABELS } from "./types";
import { connectSheets, sheetsAuthState, type SheetsClient } from "./google-sheets";
import {
  buildRow, MANAGED_HEADERS, PROTECTED_HEADERS, REQUIRED_HEADERS, ID_HEADER,
  LOG_HEADERS, HEADER_ALIASES, normHeader, dateCell, kstText,
  keepExisting, isUnknownCell,
  type LedgerBrand, type RowValues, type Cell,
} from "./ledger-sheet-rows";

export const SHEET_SYNC_MIGRATION = "0115_sheet_sync_runs.sql";

/** 헤더 5행, 데이터 6행부터. 기존 시트 구조에 맞춘 값이다. */
export const HEADER_ROW = 5;
export const FIRST_DATA_ROW = 6;

/** 갱신기록 탭의 헤더 행. */
export const LOG_HEADER_ROW = 1;

/**
 * 'running' 으로 남은 실행을 죽은 것으로 보기까지의 시간.
 *   라우트 상한이 300초라, 이 시간을 넘긴 running 은 정상 종료하지 못한 흔적이다.
 *   이 창 안에서는 force 여도 빼앗지 않는다 — 그게 동시 실행 방지의 핵심이다.
 */
export const RUNNING_STALE_MINUTES = 30;

// ── 스키마 ───────────────────────────────────────────────────
export async function sheetSyncSchemaReady(): Promise<boolean> {
  const r = await queryOne<{ ok: boolean }>(
    "SELECT to_regclass('public.sheet_sync_runs') IS NOT NULL AS ok").catch(() => null);
  return Boolean(r?.ok);
}

// ── CRM 원장 읽기(SELECT 전용) ───────────────────────────────
// CRM 테이블은 관리자 앱 연결을 사용한다. queryRo/getRoPool은 Glovek 참조용
// 계정이므로 운영에서 brands 접근이 거부된다. 권한을 확대하지 않고,
// 기존 CRM 연결에서 아래 고정 SELECT만 실행한다.
//   커뮤니케이션은 email_messages(Gmail 수집) 와 brand_emails(수기·연동 기록)를
//   하나의 사건 목록(ev)으로 합쳐 본다. 그래야 "가장 최근 기록의 시각"과
//   "그 기록의 제목·출처"가 같은 한 건에서 나온다 — 섞이지 않는다.
export const LEDGER_SQL = `
WITH ev AS (
  SELECT brand_id, direction, sent_at AS at, coalesce(subject,'') AS subject, 'gmail' AS src
    FROM email_messages WHERE brand_id IS NOT NULL AND sent_at IS NOT NULL
  UNION ALL
  SELECT brand_id, direction, occurred_at AS at, coalesce(subject,'') AS subject, 'manual' AS src
    FROM brand_emails WHERE occurred_at IS NOT NULL
),
ev_dir AS (
  SELECT brand_id,
         max(at) FILTER (WHERE direction='out') AS last_out,
         max(at) FILTER (WHERE direction='in')  AS last_in,
         count(*)::int                           AS total
    FROM ev GROUP BY brand_id
),
ev_last AS (
  SELECT DISTINCT ON (brand_id) brand_id, at, subject, src, direction
    FROM ev ORDER BY brand_id, at DESC, src
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
       ev_dir.last_out::text AS last_out_at,
       ev_dir.last_in::text  AS last_in_at,
       coalesce(ev_dir.total,0) AS total_messages,
       ev_last.at::text      AS last_any_at,
       ev_last.subject       AS last_any_subject,
       ev_last.src           AS last_any_source,
       ev_last.direction     AS last_any_direction
  FROM brands b
  LEFT JOIN ev_dir  ON ev_dir.brand_id = b.id
  LEFT JOIN ev_last ON ev_last.brand_id = b.id
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
  last_out_at: string | null; last_in_at: string | null; total_messages: number;
  last_any_at: string | null; last_any_subject: string | null;
  last_any_source: string | null; last_any_direction: string | null;
}

/** 담당자 id(=이메일) → 이름. 없으면 id 를 그대로 쓴다. */
async function ownerNames(): Promise<Map<string, string>> {
  const rows = await query<{ id: string; name: string | null }>(
    "SELECT id, name FROM admin_users").catch(() => []);
  return new Map(rows.map((r) => [r.id, (r.name ?? "").trim() || r.id]));
}

export async function readLedger(): Promise<LedgerBrand[]> {
  const [rows, owners] = await Promise.all([
    query<LedgerSqlRow>(LEDGER_SQL),
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
      lastOutAt: r.last_out_at,
      lastInAt: r.last_in_at,
      lastAnyAt: r.last_any_at,
      lastAnySubject: r.last_any_subject,
      lastAnySource: r.last_any_source,
      lastAnyDirection: r.last_any_direction,
      totalMessages: r.total_messages,
    },
  }));
}

/**
 * 담는 범위를 숫자로 설명한다 — /customers 화면의 total 과 맞춰 보기 위한 것.
 *   ledger: 이 동기화가 싣는 건수(is_test 제외, 종료 포함)
 *   customersPage: /customers 기본 필터와 같은 기준(is_test 미필터, 종료 숨김)
 */
export interface LedgerScope {
  brandsAll: number;
  ledger: number;
  testExcluded: number;
  endedInLedger: number;
  customersPage: number;
}

export async function ledgerScope(): Promise<LedgerScope | null> {
  return query<LedgerScope>(
    `SELECT count(*)::int AS "brandsAll",
            count(*) FILTER (WHERE NOT coalesce(is_test,false))::int AS "ledger",
            count(*) FILTER (WHERE coalesce(is_test,false))::int AS "testExcluded",
            count(*) FILTER (WHERE NOT coalesce(is_test,false)
                               AND state IN ('dropped','churned'))::int AS "endedInLedger",
            count(*) FILTER (WHERE state NOT IN ('dropped','churned'))::int AS "customersPage"
       FROM brands`).then((r) => r[0] ?? null).catch(() => null);
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

/** 정규화 이름 → 우리 이름. 별칭(담당자 (원장) 등)도 여기 담긴다. */
const CANONICAL_BY_NORM: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const known = [...MANAGED_HEADERS, ...PROTECTED_HEADERS];
  for (const canonical of known) {
    m.set(normHeader(canonical), canonical);
    for (const alias of HEADER_ALIASES[canonical] ?? []) m.set(normHeader(alias), canonical);
  }
  return m;
})();

export interface HeaderMap {
  /** 우리 이름 → 0-based 열 번호. */
  index: Map<string, number>;
  /** 같은 이름이 두 열에 걸렸다 — 어디에 쓸지 정할 수 없으므로 오류다. */
  duplicates: string[];
  /** 필수인데 시트에 없는 열. */
  missingRequired: string[];
}

/**
 * 시트 헤더 행을 우리 이름에 맞춘다.
 *   사람이 쓴 헤더는 띄어쓰기가 흔들린다("브랜드 ID" ↔ "브랜드ID").
 *   공백을 지워 비교하고, 글자가 다른 것은 별칭으로 잇는다.
 */
export function resolveHeaders(headerRow: readonly unknown[]): HeaderMap {
  const index = new Map<string, number>();
  const duplicates: string[] = [];
  headerRow.forEach((raw, i) => {
    const canonical = CANONICAL_BY_NORM.get(normHeader(raw));
    if (!canonical) return;                       // 우리가 모르는 열 — 건드리지 않는다
    if (index.has(canonical)) {
      if (!duplicates.includes(canonical)) duplicates.push(canonical);
      return;                                     // 먼저 나온 열을 유지하고 오류로 올린다
    }
    index.set(canonical, i);
  });
  const missingRequired = REQUIRED_HEADERS.filter((h) => !index.has(h));
  return { index, duplicates, missingRequired };
}

/** 예전 이름 — 헤더 행 → { 우리 이름: 열 번호 }. */
export function headerIndex(header: readonly unknown[]): Map<string, number> {
  return resolveHeaders(header).index;
}

/** 우리가 쓸 수 있는 열만 남긴다 — 보호 칸과 시트에 없는 열은 뺀다. */
export function writableHeaders(index: Map<string, number>): string[] {
  return MANAGED_HEADERS.filter((h) => index.has(h) && !PROTECTED_HEADERS.has(h));
}

/**
 * 한 행에서 바꿀 칸들을 연속 구간으로 묶어 범위 수를 줄인다.
 *   existing(시트의 그 행 값)을 주면, 사람이 채워 둔 칸을 "미기록"으로
 *   덮어쓰지 않도록 그 칸을 빼고 묶는다.
 */
export function rangesForRow(
  tab: string, rowNumber: number, values: RowValues,
  index: Map<string, number>, headers: string[],
  existing?: readonly unknown[],
): { range: string; values: unknown[][] }[] {
  const cells = headers
    .map((h) => ({ col: index.get(h)!, value: values[h] }))
    .filter((c) => c.value !== undefined)
    .filter((c) => !(existing && keepExisting(c.value, existing[c.col])))
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
  /** 이번 실행이 claim 되지 않았다(이미 완료 또는 다른 실행 진행 중). */
  skipped?: string;
  updated?: number;
  appended?: number;
  cells?: number;
  brands?: number;
  runId?: string;
  /** 시트의 기존 값을 지키려고 건너뛴 칸 수. */
  keptExisting?: number;
  /** 실제로 쓰지 않고 결과만 센 실행. */
  dryRun?: boolean;
  /** 열별 채움 현황 — 건수만 담는다. 값·연락처·매출은 넣지 않는다. */
  coverage?: Record<string, { filled: number; unknown: number }>;
  /** 담는 범위 숫자(/customers 와 비교용). */
  scope?: LedgerScope | null;
  /** 본 작업을 되돌리지는 않지만 사람이 알아야 하는 일들. 삼키지 않는다. */
  warnings?: string[];
}

/** KST 기준 YYYY-MM-DD. 하루 한 번 실행을 판정하는 키다. */
export function kstDateKey(now: Date): string {
  const k = new Date(now.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
}

/**
 * 같은 (시트, 날짜) 실행을 하나로 묶는 선점 SQL.
 *   · running 은 가져가지 않는다 — force 여도. 동시 실행을 막는 지점이 여기다.
 *     (RUNNING_STALE_MINUTES 를 넘긴 running 만, 죽은 실행으로 보고 회수한다.)
 *   · failed 는 다시 시도한다.
 *   · done 은 force 일 때만 다시 시도한다.
 *   테스트가 같은 문장을 쓰도록 여기서 내보낸다 — 문장이 갈라지면 검증이 무의미하다.
 */
export const CLAIM_SQL = `
  INSERT INTO sheet_sync_runs (spreadsheet_id, run_date, status, started_at)
  VALUES ($1,$2,'running',now())
  ON CONFLICT (spreadsheet_id, run_date) DO UPDATE
    SET status='running', started_at=now(), attempts = sheet_sync_runs.attempts + 1
    WHERE sheet_sync_runs.status = 'failed'
       OR (sheet_sync_runs.status = 'done' AND $3)
       OR (sheet_sync_runs.status = 'running'
           AND sheet_sync_runs.started_at < now() - make_interval(mins => $4::int))
  RETURNING id::text AS id, (xmax = 0) AS fresh`;

/**
 * 최신 실행 한 건의 감사 상태.
 *   cron 이 결과를 로그에 남기지 않아 운영에서 실패 원인을 볼 수 없다. 이 표에는
 *   이미 상태와 사유가 적혀 있으므로, 그 한 줄만 읽어 보여 준다.
 *   건수와 상태·사유 문구만 담는다 — 연락처·매출·키·토큰은 이 표에 없다.
 */
export type RunAudit =
  | {
    available: true;
    status: string; runDate: string; attempts: number;
    brands: number; updatedRows: number; appendedRows: number;
    startedAt: string | null; finishedAt: string | null; error: string;
  }
  | { available: false; unavailable: string };

/** 고정 SELECT. 이 시트 하나로 한정하고, 가장 최근 한 행만 읽는다. */
const RUN_AUDIT_SQL = `
  SELECT status, run_date::text AS run_date, attempts,
         brands, updated_rows, appended_rows,
         started_at::text AS started_at, finished_at::text AS finished_at,
         coalesce(error,'') AS error
    FROM sheet_sync_runs
   WHERE spreadsheet_id = $1
   ORDER BY run_date DESC, started_at DESC
   LIMIT 1`;

export async function latestRunAudit(): Promise<RunAudit> {
  const spreadsheetId = (env.sheets.ledgerSpreadsheetId ?? "").trim();
  if (!spreadsheetId) {
    return { available: false, unavailable: "SHEETS_LEDGER_SPREADSHEET_ID 미설정" };
  }
  if (!(await sheetSyncSchemaReady())) {
    return { available: false, unavailable: `${SHEET_SYNC_MIGRATION} 미적용 — 실행 기록 표가 없습니다` };
  }
  let row: {
    status: string; run_date: string; attempts: number;
    brands: number; updated_rows: number; appended_rows: number;
    started_at: string | null; finished_at: string | null; error: string;
  } | null;
  try {
    row = await queryOne(RUN_AUDIT_SQL, [spreadsheetId]);
  } catch {
    // 사유 원문을 싣지 않는다 — 조회가 안 됐다는 사실만 명시한다.
    return { available: false, unavailable: "실행 기록 조회 실패(DB)" };
  }
  if (!row) {
    // 실행 기록이 없다 = 선점 전에 멈췄다(인증·마이그레이션 단계). 그 자체가 단서다.
    return { available: false, unavailable: "이 시트로 실행된 기록이 없습니다(선점 전 중단)" };
  }
  return {
    available: true,
    status: row.status, runDate: row.run_date, attempts: row.attempts,
    brands: row.brands, updatedRows: row.updated_rows, appendedRows: row.appended_rows,
    startedAt: row.started_at, finishedAt: row.finished_at,
    error: String(row.error ?? "").slice(0, 300),
  };
}

export interface SyncOpts {
  now?: Date;
  /** 같은 날 다시 돌릴 때(수동 재시도). 기본은 하루 한 번만. */
  force?: boolean;
  /** 테스트용 주입. 없으면 실제 Sheets 에 연결한다. */
  client?: SheetsClient;
  /**
   * 시트를 읽기만 하고 쓰지 않는다. 첫 실행 전에 무엇이 들어갈지 세어 보는 용도.
   *   DB 의 실행 기록도 남기지 않으므로 그날의 실제 실행을 막지 않는다.
   */
  dryRun?: boolean;
}

/**
 * 행을 만들 때 쓰는 이름표 함수들. 미리보기와 실제 기록이 같은 변환을 쓰도록
 * 한곳에 둔다 — 미리보기와 결과가 달라지면 점검이 무의미하다.
 */
export function rowOptions(collectedAt: string) {
  return {
    adminUrl: env.adminUrl,
    collectedAt,
    stateLabel: (s: string | null) => (s && STATE_LABELS[s as keyof typeof STATE_LABELS]) || s || "",
    sourceLabel: (s: string | null) => (s && SOURCE_LABELS[s]) || s || "",
    planLabel: (p: string | null, pay: string | null) => {
      const planName = (p && PLAN_LABELS[p as keyof typeof PLAN_LABELS]) || p || "";
      return [planName, pay && pay !== "none" ? pay : ""].filter(Boolean).join(" · ");
    },
  };
}

/** 두 칸 값이 같은가 — 날짜 시리얼(숫자)과 글자를 함께 다룬다. */
export function sameCell(a: unknown, b: unknown): boolean {
  if (typeof b === "number") {
    const n = typeof a === "number" ? a : Number(String(a ?? "").trim());
    return Number.isFinite(n) && Math.abs(n - b) < 1e-9;
  }
  return String(a ?? "").trim() === String(b ?? "").trim();
}

export async function syncLedgerToSheet(opts: SyncOpts = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const runDate = kstDateKey(now);
  const warnings: string[] = [];

  const auth = sheetsAuthState();
  if (!opts.client && !auth.ready) return { ok: false, error: auth.reason };
  if (!(await sheetSyncSchemaReady())) {
    return { ok: false, error: `마이그레이션 ${SHEET_SYNC_MIGRATION} 미적용` };
  }

  const spreadsheetId = (env.sheets.ledgerSpreadsheetId ?? "").trim();
  const tab = (env.sheets.ledgerTab ?? "").trim();

  // 겹침 방지 + 멱등. 미리보기는 아무것도 쓰지 않으므로 선점하지 않는다 —
  // 그날의 실제 실행을 미리보기가 잡아먹으면 안 된다.
  let runId = "";
  if (!opts.dryRun) {
    let claim: { id: string; fresh: boolean } | null;
    try {
      claim = await queryOne<{ id: string; fresh: boolean }>(
        CLAIM_SQL,
        [spreadsheetId || "(unset)", runDate, Boolean(opts.force), RUNNING_STALE_MINUTES]);
    } catch (e) {
      // DB 오류를 "이미 끝났다"로 오해하지 않는다. 실패는 실패다.
      return { ok: false, error: `실행 기록을 선점하지 못했습니다(DB 오류): ${(e as Error).message.slice(0, 160)}` };
    }

    if (!claim) {
      let status: string | null = null;
      let lookupFailed = false;
      try {
        const cur = await queryOne<{ status: string }>(
          "SELECT status FROM sheet_sync_runs WHERE spreadsheet_id=$1 AND run_date=$2",
          [spreadsheetId || "(unset)", runDate]);
        status = cur?.status ?? null;
      } catch {
        lookupFailed = true;
      }
      if (lookupFailed) {
        return { ok: false, error: "선점하지 못했고 현재 상태도 확인하지 못했습니다(DB 오류)." };
      }
      return {
        ok: true,
        skipped: status === "running"
          ? `다른 실행이 진행 중입니다(${runDate}). 겹쳐 쓰지 않고 멈춥니다.`
          : `오늘(${runDate}) 이미 기록을 마쳤습니다.`,
      };
    }
    runId = claim.id;
  }

  const closeFailed = async (error: string): Promise<SyncResult> => {
    if (opts.dryRun) return { ok: false, error, dryRun: true, warnings };
    try {
      // 지난 성공 기록을 지우지 않는다 — 이번 실행 행만 실패로 닫는다.
      await query(
        "UPDATE sheet_sync_runs SET status='failed', error=$2, finished_at=now() WHERE id=$1::uuid",
        [runId, error.slice(0, 300)]);
    } catch (e) {
      warnings.push(`실패 기록을 남기지 못했습니다: ${(e as Error).message.slice(0, 120)}`);
    }
    return { ok: false, error, runId, warnings: warnings.length ? warnings : undefined };
  };

  let client = opts.client;
  if (!client) {
    const conn = await connectSheets(spreadsheetId);
    if (!conn.ok) return closeFailed(conn.error);
    client = conn.client;
  }

  try {
    // ── 쓰기 전 점검 ───────────────────────────────────────
    const header = (await client.getValues(`'${tab}'!${HEADER_ROW}:${HEADER_ROW}`))[0] ?? [];
    const { index, duplicates, missingRequired } = resolveHeaders(header);
    if (!index.has(ID_HEADER)) {
      return closeFailed(`헤더 ${HEADER_ROW}행에서 '${ID_HEADER}' 열을 찾지 못했습니다.`);
    }
    if (duplicates.length) {
      return closeFailed(`헤더 ${HEADER_ROW}행에 같은 열이 두 번 있습니다: ${duplicates.join(", ")}`);
    }
    if (missingRequired.length) {
      return closeFailed(`필수 열이 없습니다: ${missingRequired.join(", ")}`);
    }
    const headers = writableHeaders(index);
    if (headers.length === 0) return closeFailed("기록할 수 있는 열이 없습니다.");

    // 기존 데이터 블록을 통째로 읽는다. 세 가지에 쓴다:
    //   ① 브랜드 ID → 행 번호 (정렬이 바뀌어도 ID 로 찾으므로 안전하다)
    //   ② 각 칸에 이미 적힌 값 — 사람이 채워 둔 칸을 덮어쓰지 않기 위한 근거
    //   ③ 같은 브랜드 ID 가 두 행에 있는지 — 있으면 쓰기 전에 멈춘다
    const idColIdx = index.get(ID_HEADER)!;
    const lastColIdx = Math.max(header.length - 1, ...index.values());
    const grid = await client.getValues(
      `'${tab}'!A${FIRST_DATA_ROW}:${colLetter(lastColIdx)}`);
    const rowOf = new Map<string, number>();
    const existingOf = new Map<number, readonly unknown[]>();
    const dupIds: string[] = [];
    grid.forEach((r, i) => {
      const rowNumber = FIRST_DATA_ROW + i;
      existingOf.set(rowNumber, r ?? []);
      const v = String(r?.[idColIdx] ?? "").trim();
      if (!v) return;
      if (rowOf.has(v)) { if (dupIds.length < 5) dupIds.push(v); return; }
      rowOf.set(v, rowNumber);
    });
    if (dupIds.length) {
      return closeFailed(
        `시트에 같은 브랜드 ID 가 여러 행에 있습니다(${dupIds.length}건 이상). `
        + "어느 행을 갱신할지 정할 수 없어 쓰지 않았습니다.");
    }

    // ── 행 만들기 ──────────────────────────────────────────
    const brands = await readLedger();
    const scope = await ledgerScope();
    const collectedAt = now.toISOString();
    const o = rowOptions(collectedAt);

    const updates: { range: string; values: unknown[][] }[] = [];
    const appends: unknown[][] = [];
    let updated = 0;
    let keptExisting = 0;
    let withMail = 0;

    // 열별 채움 현황 — 건수만 센다. 첫 실행 전에 "무엇이 비어 있나"를 보기 위한 것.
    const coverage: Record<string, { filled: number; unknown: number }> = {};
    for (const h of headers) coverage[h] = { filled: 0, unknown: 0 };

    // 덧붙일 행은 헤더 전체 너비로 만들되, 보호 칸은 빈칸으로 둔다(사람이 나중에 쓴다).
    const width = header.length || lastColIdx + 1;

    for (const b of brands) {
      const values = buildRow(b, o);
      if (b.comms.lastAnyAt) withMail += 1;
      for (const h of headers) {
        if (isUnknownCell(values[h])) coverage[h].unknown += 1;
        else coverage[h].filled += 1;
      }
      const row = rowOf.get(b.id);
      if (row) {
        const ranges = rangesForRow(tab, row, values, index, headers, existingOf.get(row));
        // 지켜 준 칸 수 = 쓸 수 있었던 칸 − 실제로 쓰는 칸
        const writing = ranges.reduce((n, r) => n + (r.values[0]?.length ?? 0), 0);
        keptExisting += headers.filter((h) => values[h] !== undefined).length - writing;
        updates.push(...ranges);
        updated += 1;
      } else {
        const line = new Array<Cell>(width).fill("");
        for (const h of headers) line[index.get(h)!] = values[h] ?? "";
        appends.push(line);
      }
    }

    if (opts.dryRun) {
      // 아무것도 쓰지 않는다. 몇 칸이 바뀌는지와 열별 현황만 돌려준다.
      const cells = updates.reduce((n, r) => n + (r.values[0]?.length ?? 0), 0);
      return {
        ok: true, dryRun: true, brands: brands.length,
        updated, appended: appends.length, cells, keptExisting, coverage, scope,
        warnings: warnings.length ? warnings : undefined,
      };
    }

    // ── 쓰기 ───────────────────────────────────────────────
    let cells = 0;
    // 한 번에 너무 많이 보내지 않는다 — 요청이 커지면 중간에서 끊긴다.
    for (let i = 0; i < updates.length; i += 500) {
      cells += await client.batchUpdate(updates.slice(i, i + 500));
    }
    let appended = 0;
    if (appends.length) {
      appended = await client.append(`'${tab}'!A${FIRST_DATA_ROW}`, appends);
    }

    // ── 쓴 뒤 확인(readback) ───────────────────────────────
    //   수집시각은 이번 실행에서 모든 대상 행에 새로 들어간다. 그 값이 실제로
    //   시트에 있는지 다시 읽어 센다. 확인되지 않으면 성공으로 표시하지 않는다.
    const stampCol = colLetter(index.get("수집시각(KST)")!);
    const want = dateCell(collectedAt);
    const back = await client.getValues(
      `'${tab}'!${stampCol}${FIRST_DATA_ROW}:${stampCol}`);
    const matched = back.reduce((n, r) => n + (sameCell(r?.[0], want) ? 1 : 0), 0);
    const expected = updated + appended;
    if (matched < expected) {
      return closeFailed(
        `쓴 내용을 다시 읽어 확인하지 못했습니다 — 기대 ${expected}행, 확인 ${matched}행. `
        + "부분 기록일 수 있어 성공으로 표시하지 않았습니다.");
    }

    try {
      await query(
        `UPDATE sheet_sync_runs
            SET status='done', finished_at=now(),
                brands=$2, updated_rows=$3, appended_rows=$4, error=''
          WHERE id=$1::uuid`,
        [runId, brands.length, updated, appended]);
    } catch (e) {
      // 시트에는 들어갔다. 그 사실을 숨기지 않고, 기록 갱신 실패를 그대로 올린다.
      warnings.push(
        `시트 기록은 끝났지만 실행 기록을 'done' 으로 갱신하지 못했습니다: `
        + `${(e as Error).message.slice(0, 120)} (오늘 재시도가 ${RUNNING_STALE_MINUTES}분간 막힙니다)`);
    }

    // 갱신기록 탭은 성공한 뒤에만 쓴다. 헤더가 우리가 아는 모양인지 먼저 확인한다 —
    // 모양이 다르면 숫자가 엉뚱한 열에 들어가므로, 쓰지 않고 알린다.
    const logTab = (env.sheets.logTab ?? "").trim();
    if (logTab) {
      try {
        const logHead = (await client.getValues(
          `'${logTab}'!A${LOG_HEADER_ROW}:${colLetter(LOG_HEADERS.length - 1)}${LOG_HEADER_ROW}`))[0] ?? [];
        const got = logHead.map((h) => normHeader(h));
        const mismatch = LOG_HEADERS.findIndex((h, i) => got[i] !== normHeader(h));
        if (mismatch >= 0) {
          warnings.push(
            `갱신기록 탭 헤더가 예상과 다릅니다(${colLetter(mismatch)}열). `
            + "숫자가 엉뚱한 열에 들어가지 않도록 기록을 건너뛰었습니다.");
        } else {
          await client.append(`'${logTab}'!A${LOG_HEADER_ROW}`, [[
            dateCell(collectedAt),            // A 기록시각(KST)
            brands.length,                    // B 원장건수
            appended,                         // C 추가건수
            updated,                          // D 변경건수
            withMail,                         // E 메일확인 업체
            "성공",                            // F 실행상태
            `${runDate} (KST 기준 1일 1회)`,   // G 기록 기준
            "admin.glovek.space 원장(brands, is_test 제외)",  // H 원본
          ]]);
        }
      } catch (e) {
        warnings.push(`갱신기록 탭에 쓰지 못했습니다: ${(e as Error).message.slice(0, 120)}`);
      }
    }

    return {
      ok: true, brands: brands.length, updated, appended, cells,
      keptExisting, coverage, scope, runId,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (e) {
    return closeFailed((e as Error).message.slice(0, 300));
  }
}

/** 사람이 읽는 한 줄 요약 — 로그에 연락처·매출을 남기지 않는다. */
export function summarize(r: SyncResult, now = new Date()): string {
  if (r.skipped) return `[sheets] ${kstText(now.toISOString())} 건너뜀 — ${r.skipped}`;
  if (!r.ok) return `[sheets] ${kstText(now.toISOString())} 실패 — ${r.error ?? "사유 미기록"}`;
  return `[sheets] ${kstText(now.toISOString())} ${r.dryRun ? "미리보기" : "기록"} `
    + `원장 ${r.brands ?? 0} · 변경 ${r.updated ?? 0} · 추가 ${r.appended ?? 0} · 보존 ${r.keptExisting ?? 0}`
    + (r.warnings?.length ? ` · 경고 ${r.warnings.length}건` : "");
}
