// 카카오톡 대화 수집 — 방↔브랜드 매핑과 수집 상태.
//   이 파일에는 고객에게 무언가를 보내는 경로가 없다. 받아서 저장하기만 한다.
//
//   지키는 것
//     · 방이 어느 브랜드인지 담당자가 확인해 연결(linked)하기 전에는 메시지를 저장하지 않는다.
//       자동으로 브랜드를 추측해 붙이지 않는다.
//     · 같은 메시지를 두 번 받아도 한 번만 저장한다(brand_id + source_ref 유니크).
//     · 수집기가 실제로 보내 저장까지 된 적이 없으면 "자동 수집됨"이라고 말하지 않는다.
import { query, queryOne } from "./db";

export const KAKAO_SCHEMA_MIGRATION = "0106_kakao_rooms.sql";
/** 수집기 인증에 쓰는 환경변수 이름. 값은 코드에 두지 않는다(미설정이면 수집을 거부한다). */
export const KAKAO_SECRET_ENV = "KAKAO_INGEST_SECRET";

export async function kakaoSchemaState(): Promise<{ ready: boolean; missing: string[]; error?: string }> {
  const need = ["kakao_rooms", "kakao_ingest_runs"];
  try {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`, [need]);
    const have = new Set(rows.map((r) => r.table_name));
    const missing = need.filter((t) => !have.has(t));
    const cols = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='pm_manual_comms' AND column_name='source_ref'`);
    if (cols.length === 0) missing.push("pm_manual_comms.source_ref");
    return { ready: missing.length === 0, missing };
  } catch (e) {
    return { ready: false, missing: need, error: (e as Error).message.slice(0, 200) };
  }
}

export interface KakaoRoom {
  id: string; roomKey: string; roomName: string;
  brandId: string | null; brandName: string | null;
  status: "pending" | "linked" | "ignored";
  note: string;
  lastSeenAt: string | null; lastMessageAt: string | null; lastIngestAt: string | null;
  lastError: string; storedCount: number;
  linkedBy: string | null; linkedAt: string | null;
  createdAt: string;
}

const ROOM_COLS = `r.id, r.room_key, r.room_name, r.brand_id::text AS brand_id, b.brand_name,
  r.status, r.note, r.last_seen_at::text AS last_seen_at, r.last_message_at::text AS last_message_at,
  r.last_ingest_at::text AS last_ingest_at, r.last_error, r.stored_count,
  r.linked_by, r.linked_at::text AS linked_at, r.created_at::text AS created_at`;

interface RoomRow {
  id: string; room_key: string; room_name: string; brand_id: string | null; brand_name: string | null;
  status: string; note: string; last_seen_at: string | null; last_message_at: string | null;
  last_ingest_at: string | null; last_error: string; stored_count: number;
  linked_by: string | null; linked_at: string | null; created_at: string;
}
const toRoom = (r: RoomRow): KakaoRoom => ({
  id: r.id, roomKey: r.room_key, roomName: r.room_name,
  brandId: r.brand_id, brandName: r.brand_name,
  status: (["pending", "linked", "ignored"].includes(r.status) ? r.status : "pending") as KakaoRoom["status"],
  note: r.note, lastSeenAt: r.last_seen_at, lastMessageAt: r.last_message_at,
  lastIngestAt: r.last_ingest_at, lastError: r.last_error, storedCount: r.stored_count,
  linkedBy: r.linked_by, linkedAt: r.linked_at, createdAt: r.created_at,
});

export async function listKakaoRooms(limit = 200): Promise<KakaoRoom[]> {
  const rows = await query<RoomRow>(
    `SELECT ${ROOM_COLS} FROM kakao_rooms r LEFT JOIN brands b ON b.id = r.brand_id
      ORDER BY (r.status='pending') DESC, r.last_seen_at DESC NULLS LAST, r.created_at DESC
      LIMIT $1`, [limit]);
  return rows.map(toRoom);
}

export async function listRoomsForBrand(brandId: string): Promise<KakaoRoom[]> {
  const rows = await query<RoomRow>(
    `SELECT ${ROOM_COLS} FROM kakao_rooms r LEFT JOIN brands b ON b.id = r.brand_id
      WHERE r.brand_id = $1 ORDER BY r.last_message_at DESC NULLS LAST`, [brandId]);
  return rows.map(toRoom);
}

/** 담당자가 방을 브랜드에 연결한다. 연결 전에는 그 방의 메시지가 저장되지 않는다. */
export async function linkKakaoRoom(roomId: string, brandId: string | null, by: string):
  Promise<{ ok: boolean; error?: string }> {
  if (brandId) {
    const b = await queryOne<{ id: string }>("SELECT id FROM brands WHERE id=$1::uuid", [brandId]);
    if (!b) return { ok: false, error: "존재하지 않는 브랜드입니다." };
  }
  const r = await query<{ id: string }>(
    // $2 는 NULL 로도 들어오므로 타입을 명시한다(추론 실패로 전체 쿼리가 거부된다).
    `UPDATE kakao_rooms SET brand_id = $2::uuid,
            status = CASE WHEN $2::uuid IS NULL THEN 'pending' ELSE 'linked' END,
            linked_by=$3, linked_at=now(), updated_at=now()
      WHERE id = $1::uuid RETURNING id`, [roomId, brandId, by]);
  if (r.length === 0) return { ok: false, error: "방을 찾지 못했습니다." };
  return { ok: true };
}

export async function setKakaoRoomStatus(roomId: string, status: "pending" | "ignored", by: string):
  Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ id: string }>(
    `UPDATE kakao_rooms SET status=$2, linked_by=$3, updated_at=now()
      WHERE id = $1::uuid RETURNING id`, [roomId, status, by]);
  if (r.length === 0) return { ok: false, error: "방을 찾지 못했습니다." };
  return { ok: true };
}

export async function setKakaoRoomNote(roomId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ id: string }>(
    "UPDATE kakao_rooms SET note=$2, updated_at=now() WHERE id=$1::uuid RETURNING id",
    [roomId, (note ?? "").slice(0, 1000)]);
  if (r.length === 0) return { ok: false, error: "방을 찾지 못했습니다." };
  return { ok: true };
}

// ── 수집 ────────────────────────────────────────────────────
export interface IncomingMessage {
  /** 수집기가 주는 메시지 고유값. 같은 값이 다시 와도 한 번만 저장한다. */
  externalId: string;
  /** 실제 대화 시각(ISO). 수집기가 주지 않으면 저장하지 않는다 — 시각을 지어내지 않는다. */
  at: string;
  author?: string;
  text: string;
}

export interface IngestOutcome {
  ok: boolean;
  status: "ok" | "partial" | "error" | "rejected";
  reason: string;
  roomStatus: "pending" | "linked" | "ignored" | "unknown";
  received: number; stored: number; duplicate: number; skipped: number; failed: number;
}

const iso = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * 수집기가 보낸 한 방의 메시지를 받는다.
 *   · 처음 보는 방은 pending 으로 등록만 하고 메시지는 저장하지 않는다(브랜드 확인 필요).
 *   · ignored 방은 저장하지 않는다.
 *   · linked 방만 pm_manual_comms 에 저장하고, 같은 메시지는 중복으로 세고 넘어간다.
 */
export async function ingestKakaoMessages(input: {
  roomKey: string; roomName?: string; agent?: string; messages: IncomingMessage[];
}): Promise<IngestOutcome> {
  const roomKey = (input.roomKey ?? "").trim();
  const agent = (input.agent ?? "").slice(0, 100);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const base: IngestOutcome = {
    ok: false, status: "error", reason: "", roomStatus: "unknown",
    received: messages.length, stored: 0, duplicate: 0, skipped: 0, failed: 0,
  };
  if (!roomKey) {
    await logRun({ roomKey: "", agent, ...base, status: "rejected", reason: "room_key 가 없습니다" });
    return { ...base, status: "rejected", reason: "room_key 가 없습니다" };
  }

  // 방 등록(처음 보는 방은 pending). 이름은 바뀔 수 있으니 갱신한다.
  const room = await queryOne<RoomRow>(
    `INSERT INTO kakao_rooms (room_key, room_name, last_seen_at)
     VALUES ($1,$2,now())
     ON CONFLICT (room_key) DO UPDATE SET
       room_name = CASE WHEN EXCLUDED.room_name <> '' THEN EXCLUDED.room_name ELSE kakao_rooms.room_name END,
       last_seen_at = now(), updated_at = now()
     RETURNING id, room_key, room_name, brand_id::text AS brand_id, NULL::text AS brand_name,
               status, note, last_seen_at::text AS last_seen_at, last_message_at::text AS last_message_at,
               last_ingest_at::text AS last_ingest_at, last_error, stored_count,
               linked_by, linked_at::text AS linked_at, created_at::text AS created_at`,
    [roomKey, (input.roomName ?? "").slice(0, 300)]);
  if (!room) {
    await logRun({ roomKey, agent, ...base, reason: "방 등록 실패" });
    return { ...base, reason: "방 등록 실패" };
  }

  const status = room.status as IngestOutcome["roomStatus"];
  if (status !== "linked" || !room.brand_id) {
    const reason = status === "ignored"
      ? "수집 대상이 아닌 방으로 표시돼 있습니다"
      : "브랜드가 연결되지 않은 방입니다 — 담당자 확인 전에는 저장하지 않습니다";
    const out: IngestOutcome = {
      ...base, ok: true, status: "ok", reason, roomStatus: status, skipped: messages.length,
    };
    await logRun({ roomKey, agent, ...out });
    return out;
  }

  let stored = 0, duplicate = 0, failed = 0, skipped = 0;
  let newest: string | null = null;
  for (const m of messages) {
    const at = iso(m?.at);
    const text = String(m?.text ?? "").trim();
    const ext = String(m?.externalId ?? "").trim();
    // 시각이나 본문이 없으면 저장하지 않는다(시각을 지어내지 않는다).
    if (!at || !text || !ext) { skipped += 1; continue; }
    try {
      const r = await queryOne<{ id: string }>(
        `INSERT INTO pm_manual_comms
           (brand_id, channel, occurred_at, author, source_label, source_url, body, created_by, source_ref, ingest_source)
         VALUES ($1,'kakao',$2,$3,$4,'',$5,$6,$7,'kakao_collector')
         ON CONFLICT (brand_id, source_ref) WHERE source_ref <> '' DO NOTHING
         RETURNING id`,
        [room.brand_id, at, String(m.author ?? "").slice(0, 200),
         `카카오톡 · ${room.room_name || roomKey}`.slice(0, 300), text.slice(0, 20000),
         "kakao_collector", `kakao:${roomKey}:${ext}`.slice(0, 300)]);
      if (r) { stored += 1; if (!newest || at > newest) newest = at; }
      else duplicate += 1;
    } catch {
      failed += 1;
    }
  }

  const outStatus: IngestOutcome["status"] = failed > 0 ? "partial" : "ok";
  await query(
    `UPDATE kakao_rooms SET
        last_message_at = GREATEST(COALESCE(last_message_at, to_timestamp(0)), COALESCE($2::timestamptz, to_timestamp(0))),
        last_ingest_at = CASE WHEN $3 > 0 THEN now() ELSE last_ingest_at END,
        stored_count = stored_count + $3,
        last_error = $4, updated_at = now()
      WHERE room_key = $1`,
    [roomKey, newest, stored, failed > 0 ? `${failed}건 저장 실패` : ""]).catch(() => {});

  const out: IngestOutcome = {
    ok: true, status: outStatus,
    reason: failed > 0 ? `${failed}건 저장 실패` : "",
    roomStatus: "linked", received: messages.length, stored, duplicate, skipped, failed,
  };
  await logRun({ roomKey, agent, ...out });
  return out;
}

async function logRun(r: {
  roomKey: string; agent: string; received: number; stored: number; duplicate: number;
  skipped: number; failed: number; status: string; reason: string;
}): Promise<void> {
  await query(
    `INSERT INTO kakao_ingest_runs (room_key, agent, received, stored, duplicate, skipped, failed, status, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [r.roomKey, r.agent, r.received, r.stored, r.duplicate, r.skipped, r.failed, r.status, r.reason.slice(0, 500)],
  ).catch(() => {});
}

export interface IngestRunRow {
  id: string; room_key: string; agent: string; received: number; stored: number;
  duplicate: number; skipped: number; failed: number; status: string; reason: string; created_at: string;
}
export async function listKakaoRuns(limit = 30): Promise<IngestRunRow[]> {
  return query<IngestRunRow>(
    `SELECT id, room_key, agent, received, stored, duplicate, skipped, failed, status, reason,
            created_at::text AS created_at
       FROM kakao_ingest_runs ORDER BY created_at DESC LIMIT $1`, [limit]);
}

/**
 * 브랜드의 카카오 수집 상태 한 줄 요약.
 *   수집기가 실제로 저장한 적이 없으면 "수집기 미연결"이라고 그대로 말한다.
 */
export interface BrandKakaoState {
  ready: boolean;
  rooms: number;
  linked: number;
  pending: number;
  lastIngestAt: string | null;
  lastMessageAt: string | null;
  note: string;
}
export async function brandKakaoState(brandId: string): Promise<BrandKakaoState> {
  const empty: BrandKakaoState = {
    ready: false, rooms: 0, linked: 0, pending: 0, lastIngestAt: null, lastMessageAt: null,
    note: "자동 수집 경로가 없습니다 — 원문 수동 등록만 가능합니다.",
  };
  const schema = await kakaoSchemaState();
  if (!schema.ready) return empty;
  try {
    const r = await queryOne<{ linked: string; last_ingest: string | null; last_msg: string | null }>(
      `SELECT count(*) FILTER (WHERE status='linked')::text AS linked,
              max(last_ingest_at)::text AS last_ingest,
              max(last_message_at)::text AS last_msg
         FROM kakao_rooms WHERE brand_id=$1`, [brandId]);
    const pend = await queryOne<{ n: string }>(
      "SELECT count(*)::text AS n FROM kakao_rooms WHERE status='pending'");
    const linked = Number(r?.linked ?? 0);
    const pending = Number(pend?.n ?? 0);
    const lastIngestAt = r?.last_ingest ?? null;
    const note = linked === 0
      ? `이 브랜드에 연결된 카카오 방이 없습니다${pending ? ` · 확인 대기 방 ${pending}개` : ""} — 수집기 미연결`
      : lastIngestAt
        ? `연결된 방 ${linked}개 · 수집기에서 마지막으로 받은 시각 ${lastIngestAt.slice(0, 16).replace("T", " ")}`
        : `연결된 방 ${linked}개 · 수집기에서 받은 기록이 아직 없습니다(수집기 미연결)`;
    return { ready: true, rooms: linked + pending, linked, pending, lastIngestAt, lastMessageAt: r?.last_msg ?? null, note };
  } catch {
    return empty;
  }
}
