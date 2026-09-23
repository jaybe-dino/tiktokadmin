// 연속 안내 "목록보기" — 조회 전용(발송·수정 없음).
//   화면: /channels/<키>/sequence
//   저장된 값만으로 상태를 판정한다. 새 DB 변경 없이 lead_sequence_sends 의
//   status · channels · note · sent_at 을 그대로 근거로 쓴다.
import { query, queryOne } from "./db";
import { seqDbError } from "./lead-sequence";

// ── 표시 상태 ────────────────────────────────────────────────
// 저장 status 는 queued/sent/skipped/failed/canceled 5가지지만,
// "일부만 나간 건"과 "테스트 모드 건"이 sent 로 뭉뚱그려져 있다.
// 목록에서는 이를 갈라 보여준다(부분 실패를 완료로 오인하지 않게).
export type ViewStatus = "queued" | "sent" | "partial" | "test" | "failed" | "skipped" | "canceled";

export const VIEW_STATUS: { key: ViewStatus; label: string; desc: string; tone: "wait" | "ok" | "warn" | "bad" | "off" }[] = [
  { key: "queued", label: "예정", desc: "아직 보내지 않음", tone: "wait" },
  { key: "sent", label: "발송 완료", desc: "문자·메일이 공급자에 접수됨", tone: "ok" },
  { key: "partial", label: "부분 실패", desc: "한쪽만 나가고 다른 쪽은 실패", tone: "warn" },
  { key: "test", label: "테스트", desc: "테스트 모드 — 실제로 보내지 않음", tone: "off" },
  { key: "failed", label: "실패", desc: "발송 시도했으나 실패", tone: "bad" },
  { key: "skipped", label: "건너뜀", desc: "회차 꺼짐·문구 없음·연락처 없음", tone: "off" },
  { key: "canceled", label: "중단", desc: "단계 진전·수신거부·드랍 등으로 취소", tone: "off" },
];
export const VIEW_STATUS_KEYS = VIEW_STATUS.map((s) => s.key);
export function viewStatusLabel(k: string): string {
  return VIEW_STATUS.find((s) => s.key === k)?.label ?? k;
}

/**
 * 수단(문자·메일)별 표시값.
 *   pending  아직 처리 전 — 발송될지 여부는 처리 시점에 정해진다
 *   sent     공급자에 접수됨
 *   failed   시도했으나 실패
 *   test     테스트 모드 — 실제로 보내지 않음
 *   canceled 처리 전에 중단됨
 *   none     처리했으나 이 수단은 대상이 아니었음(회차 꺼짐·연락처/문구 없음)
 */
// 발송 실패·테스트는 워커가 note 에 이 문구로 남긴다(lib/lead-sequence.ts).
const SMS_FAIL = "문자 실패";
const MAIL_FAIL = "메일 실패";
const TEST_NOTE = "테스트 모드";

export type ChannelResult = "pending" | "sent" | "failed" | "test" | "canceled" | "none";

export const CHANNEL_RESULT_LABEL: Record<ChannelResult, string> = {
  pending: "발송 대기",
  sent: "발송(접수)",
  failed: "실패",
  test: "테스트(미발송)",
  canceled: "중단",
  none: "대상 아님",
};

/**
 * 수단별 결과 — 저장값만으로 판정한다.
 *   ※ 처리 전(queued)·중단(canceled) 은 "대상 아님"과 반드시 구분한다.
 *     아직 안 보낸 건을 "미발송/대상 아님"으로 적으면 고객이 제외된 것처럼 읽힌다.
 */
export function channelResult(
  kind: "sms" | "email",
  row: { status: string; channels?: string[] | null; note?: string | null },
): ChannelResult {
  // 아직 처리되지 않은 건 — 저장된 결과가 없다.
  if (row.status === "queued") return "pending";
  if (row.status === "canceled") return "canceled";

  const list = row.channels ?? [];
  const n = row.note ?? "";
  const isTest = n.includes(TEST_NOTE);
  if (list.includes(kind)) return isTest ? "test" : "sent";
  if (kind === "sms" && n.includes(SMS_FAIL)) return "failed";
  if (kind === "email" && n.includes(MAIL_FAIL)) return "failed";
  return "none";   // 처리했지만 이 수단은 대상이 아니었다
}

/** 저장 status + note → 목록 표시 상태. */
export function toViewStatus(status: string, note: string | null): ViewStatus {
  const n = note ?? "";
  if (status === "sent") {
    if (n.includes(TEST_NOTE)) return "test";
    if (n.includes(SMS_FAIL) || n.includes(MAIL_FAIL)) return "partial";
    return "sent";
  }
  if (status === "queued" || status === "failed" || status === "skipped" || status === "canceled") return status;
  return "queued";
}

/** 같은 판정을 SQL 에서도 해야 필터·건수가 화면과 어긋나지 않는다. */
const VIEW_STATUS_SQL = `
  CASE
    WHEN q.status='sent' AND q.note LIKE '%${TEST_NOTE}%' THEN 'test'
    WHEN q.status='sent' AND (q.note LIKE '%${SMS_FAIL}%' OR q.note LIKE '%${MAIL_FAIL}%') THEN 'partial'
    ELSE q.status
  END`;

// ── 목록 조회 ────────────────────────────────────────────────
export const PAGE_SIZE = 50;

export interface SeqSendRow {
  id: string;
  brand_id: string;
  brand_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  state: string;
  day_no: number;
  due_at: string;
  sent_at: string | null;
  channels: string[];
  status: string;        // 저장 원본
  view_status: ViewStatus;
  note: string;
}

export interface SeqSendPage {
  rows: SeqSendRow[];
  total: number;                       // 필터 적용 후 전체 건수
  page: number;
  pages: number;
  counts: Record<string, number>;      // 상태별 건수(필터 없이)
}

export function clampPage(p: unknown, pages: number): number {
  const n = Math.round(Number(p) || 1);
  return Math.min(Math.max(1, n), Math.max(1, pages));
}

/**
 * 한 유입 키의 예정·이력 목록. 조회 실패는 숨기지 않고 예외로 올린다.
 *   status 가 비면 전체. 페이지는 1부터.
 */
export async function listSeqSends(channelId: string, opts: { status?: string; page?: number } = {}): Promise<SeqSendPage> {
  const status = VIEW_STATUS_KEYS.includes(opts.status as ViewStatus) ? (opts.status as ViewStatus) : "";

  // 상태별 건수 — 필터와 무관하게 항상 전체 기준(탭에 숫자를 보여주기 위함).
  const countRows = await query<{ view_status: string; n: string }>(
    `SELECT ${VIEW_STATUS_SQL} AS view_status, count(*)::text AS n
       FROM lead_sequence_sends q WHERE q.channel_id=$1 GROUP BY 1`, [channelId]);
  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.view_status] = Number(r.n);
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);

  const total = status ? (counts[status] ?? 0) : totalAll;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = clampPage(opts.page, pages);

  const args: unknown[] = [channelId];
  let where = "q.channel_id=$1";
  if (status) { args.push(status); where += ` AND ${VIEW_STATUS_SQL}=$${args.length}`; }
  args.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const rows = await query<Omit<SeqSendRow, "view_status">>(
    `SELECT q.id, q.brand_id, q.day_no, q.due_at::text AS due_at, q.sent_at::text AS sent_at,
            q.channels, q.status, q.note,
            b.brand_name, b.contact_name, b.email, b.phone, b.state
       FROM lead_sequence_sends q JOIN brands b ON b.id = q.brand_id
      WHERE ${where}
      ORDER BY q.due_at ${status === "queued" ? "ASC" : "DESC"}, q.day_no
      LIMIT $${args.length - 1} OFFSET $${args.length}`, args);

  return {
    rows: rows.map((r) => ({ ...r, view_status: toViewStatus(r.status, r.note) })),
    total, page, pages, counts,
  };
}

/** 목록 조회 결과를 오류까지 함께(화면에서 로딩·빈목록·오류를 구분하기 위함). */
export async function loadSeqSends(channelId: string, opts: { status?: string; page?: number } = {}):
  Promise<{ ok: true; data: SeqSendPage } | { ok: false; error: string }> {
  try { return { ok: true, data: await listSeqSends(channelId, opts) }; }
  catch (e) { return { ok: false, error: seqDbError(e) }; }
}

/** 키 1건 정보(이름·소스·테스트모드) — 목록 화면 머리말용. */
export async function getChannelBrief(channelId: string): Promise<{ id: string; name: string; source: string; test_mode: boolean } | null> {
  return queryOne<{ id: string; name: string; source: string; test_mode: boolean }>(
    "SELECT id, name, source, test_mode FROM intake_channels WHERE id=$1", [channelId]);
}

// ── 본문 안의 링크 ───────────────────────────────────────────
export type TextPart = { t: "text"; v: string } | { t: "link"; v: string };

/** 본문을 링크/일반 텍스트 조각으로 나눈다 — 화면에서 링크만 <a> 로 그리기 위함. */
export function splitLinks(text: string): TextPart[] {
  const out: TextPart[] = [];
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let last = 0;
  for (const m of (text ?? "").matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: "text", v: text.slice(last, i) });
    out.push({ t: "link", v: m[0] });
    last = i + m[0].length;
  }
  if (last < (text ?? "").length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** 본문에 들어 있는 링크 목록(중복 제거, 등장 순서). */
export function extractLinks(text: string): string[] {
  const seen: string[] = [];
  for (const p of splitLinks(text)) if (p.t === "link" && !seen.includes(p.v)) seen.push(p.v);
  return seen;
}
