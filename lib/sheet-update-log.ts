// 수동 시트 갱신 "처리 이력" — 기록만 한다.
//
//   무엇이 아닌가
//     이 파일은 Google Sheets 를 갱신하지 않는다. 시트 갱신과 readback 은 사람이
//     연결 도구로 끝낸 뒤, 그 작업이 있었다는 사실만 여기에 남긴다.
//     서버가 Google 로 가서 독립 검증한 척하지 않는다 — 그래서 검증 방식 값이
//     'gpt_sheet_readback' 으로 고정돼 있다.
//
//   어디에 남기는가
//     새 표를 만들지 않고 기존 ingest_events(0001)를 쓴다.
//     UNIQUE (site, event, idem_key) 가 그대로 멱등 키가 된다 — idem_key = runId.
//
//   무엇을 담지 않는가
//     연락처·이메일·금액·자유 메모·임의 시트 ID. 건수와 시각, 그리고 서버가 아는
//     시트 ID 만 담는다.
import { z } from "zod";
import { query, queryOne } from "./db";
import { env } from "./env";

/** 서버 고정값 — 클라이언트가 바꿀 수 없다. 이 용도 전용 칸을 쓴다. */
export const LOG_SITE = "admin-manual";
export const LOG_EVENT = "sheets_ledger_manual_update";

/** 사람이 연결 도구로 갱신하고 시트에서 직접 readback 한 것임을 뜻한다. */
export const VERIFIED_METHOD = "gpt_sheet_readback";

/** 건수 상한 — 원장이 이보다 커지면 이 숫자를 올린다(오타 방지용 울타리). */
export const MAX_ROWS = 100_000;

const Count = z.number().int().min(0).max(MAX_ROWS);

/**
 * 받는 값. strict — 모르는 키가 하나라도 있으면 거부한다.
 *   시트 ID 는 받지 않는다(서버가 env 에서 넣는다).
 *   sourceCollectedAt 은 시간대를 명시한 ISO 만 받는다(Z 또는 ±hh:mm).
 */
export const UpdateLogInput = z.object({
  runId: z.string().uuid(),
  sourceCollectedAt: z.string().datetime({ offset: true }),
  sourceCount: z.number().int().positive().max(MAX_ROWS),
  updatedRows: Count,
  appendedRows: Count,
  verifiedRows: Count,
}).strict()
  .refine((v) => v.updatedRows + v.appendedRows === v.sourceCount, {
    message: "기존갱신 + 신규 합이 대상 건수와 같아야 합니다.",
    path: ["sourceCount"],
  })
  .refine((v) => v.verifiedRows === v.sourceCount, {
    message: "검증 건수가 대상 건수와 같아야 합니다(readback 으로 전부 확인된 경우만 기록).",
    path: ["verifiedRows"],
  });

export type UpdateLogInput = z.infer<typeof UpdateLogInput>;

/** ingest_events.payload 에 저장하는 모양. */
export interface StoredPayload {
  spreadsheetId: string;
  sourceCollectedAt: string;
  sourceCount: number;
  updatedRows: number;
  appendedRows: number;
  verifiedRows: number;
  actor: string;
  verifiedMethod: typeof VERIFIED_METHOD;
  recordedAt: string;
}

/** 같은 runId 재시도인지 판정할 때 비교하는 필드 — 서버가 붙이는 값은 뺀다. */
const COMPARED: (keyof StoredPayload)[] = [
  "spreadsheetId", "sourceCollectedAt", "sourceCount",
  "updatedRows", "appendedRows", "verifiedRows", "verifiedMethod",
];

export function samePayload(a: Partial<StoredPayload>, b: Partial<StoredPayload>): boolean {
  return COMPARED.every((k) => a[k] === b[k]);
}

export type RecordResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; status: 409 | 500; error: string };

export async function recordManualUpdate(
  input: UpdateLogInput, actor: string,
): Promise<RecordResult> {
  const spreadsheetId = (env.sheets.ledgerSpreadsheetId ?? "").trim();
  if (!spreadsheetId) {
    return { ok: false, status: 500, error: "대상 시트 ID 설정이 없습니다(SHEETS_LEDGER_SPREADSHEET_ID)." };
  }
  const payload: StoredPayload = {
    spreadsheetId,
    sourceCollectedAt: input.sourceCollectedAt,
    sourceCount: input.sourceCount,
    updatedRows: input.updatedRows,
    appendedRows: input.appendedRows,
    verifiedRows: input.verifiedRows,
    actor,
    verifiedMethod: VERIFIED_METHOD,
    recordedAt: new Date().toISOString(),
  };

  try {
    // 새 기록은 INSERT 하나뿐이다. 다른 표(brands·메일 등)는 건드리지 않는다.
    const ins = await queryOne<{ id: string }>(
      `INSERT INTO ingest_events (site, event, idem_key, payload, status)
       VALUES ($1,$2,$3,$4::jsonb,'ok')
       ON CONFLICT (site, event, idem_key) DO NOTHING
       RETURNING id::text AS id`,
      [LOG_SITE, LOG_EVENT, input.runId, JSON.stringify(payload)]);
    if (ins) return { ok: true, id: ins.id, duplicate: false };

    // 이미 있는 runId — 같은 내용이면 같은 id 를 돌려주고, 다르면 충돌이다.
    const cur = await queryOne<{ id: string; payload: StoredPayload }>(
      "SELECT id::text AS id, payload FROM ingest_events WHERE site=$1 AND event=$2 AND idem_key=$3",
      [LOG_SITE, LOG_EVENT, input.runId]);
    if (!cur) return { ok: false, status: 500, error: "기록을 확인하지 못했습니다." };
    if (samePayload(cur.payload, payload)) return { ok: true, id: cur.id, duplicate: true };
    return {
      ok: false, status: 409,
      error: "같은 작업 번호로 다른 내용이 이미 기록돼 있습니다. 새 작업이면 새 작업 번호로 기록하세요.",
    };
  } catch {
    // 예외 원문을 싣지 않는다 — 접속 문자열·키가 섞일 수 있다.
    return { ok: false, status: 500, error: "기록에 실패했습니다(DB)." };
  }
}

export interface UpdateLogRow {
  id: string;
  recordedAt: string;
  sourceCollectedAt: string;
  sourceCount: number;
  updatedRows: number;
  appendedRows: number;
  verifiedRows: number;
  actor: string;
  verifiedMethod: string;
}

export type ListResult =
  | { ok: true; rows: UpdateLogRow[] }
  | { ok: false; error: string };

/** 이 이벤트 · 이 시트의 최근 20건. 다른 site/event 기록은 보이지 않는다. */
export async function listManualUpdates(): Promise<ListResult> {
  const spreadsheetId = (env.sheets.ledgerSpreadsheetId ?? "").trim();
  if (!spreadsheetId) return { ok: false, error: "대상 시트 ID 설정이 없습니다." };
  try {
    const rows = await query<{ id: string; created_at: string; payload: StoredPayload }>(
      `SELECT id::text AS id, created_at::text AS created_at, payload
         FROM ingest_events
        WHERE site=$1 AND event=$2 AND payload->>'spreadsheetId' = $3
        ORDER BY created_at DESC, id DESC
        LIMIT 20`,
      [LOG_SITE, LOG_EVENT, spreadsheetId]);
    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id,
        recordedAt: r.payload?.recordedAt ?? r.created_at,
        sourceCollectedAt: r.payload?.sourceCollectedAt ?? "",
        sourceCount: r.payload?.sourceCount ?? 0,
        updatedRows: r.payload?.updatedRows ?? 0,
        appendedRows: r.payload?.appendedRows ?? 0,
        verifiedRows: r.payload?.verifiedRows ?? 0,
        actor: r.payload?.actor ?? "",
        verifiedMethod: r.payload?.verifiedMethod ?? "",
      })),
    };
  } catch {
    return { ok: false, error: "기록을 읽지 못했습니다(DB)." };
  }
}
