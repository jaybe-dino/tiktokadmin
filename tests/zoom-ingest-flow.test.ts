// Zoom 수집 파이프라인 통합(순수 파싱·매칭 단위 테스트는 zoom-ingest.test.ts) — DB·Zoom API 를 가짜로 두고 끝까지 돌린다.
//   실제 Zoom 호출·실제 회의·고객 연락은 전혀 하지 않는다.
//   검증: 접수 실패 전파(재전송 가능) · 저장 실패를 "수집 완료"로 보고하지 않음 ·
//        상태 조회 오류를 0/연동됨으로 숨기지 않음 · 0097 미적용 표시 ·
//        무음·전사 미생성 회의가 무한 대기로 남지 않음 · 미매핑 후 나중 매칭.
import { describe, it, expect, vi, beforeEach } from "vitest";

const HOUR = 3600_000;

interface EventRow { id: string; event: string; dedupe_key: string; zoom_uuid: string | null; payload: unknown; status: string; attempts: number; error: string | null; received_at: number }
interface MeetingRow {
  id: string; zoom_uuid: string; zoom_meeting_id: string; brand_id: string | null; topic: string;
  host_email: string | null; status: string; match_method: string | null;
  transcript: string | null; transcript_source: string | null; transcript_status: string;
  transcript_attempts: number; transcript_next_try: number | null; transcript_error: string | null;
  transcript_fetched_at: number | null; started_at: number | null; created_at: number;
  recording_files_count: number; match_dismissed: boolean;
}
interface RecRow { zoom_uuid: string; zoom_file_id: string; meeting_id: string | null; collected: boolean }

const db = {
  now: Date.UTC(2026, 8, 26, 8, 0, 0),
  events: [] as EventRow[],
  meetings: [] as MeetingRow[],
  recordings: [] as RecRow[],
  brands: [] as { id: string; email: string | null }[],
  links: [] as { meeting_id: string; brand_id: string | null; method: string }[],
  // 0097 적용 상태(스키마 probe 용)
  tables: new Set(["zoom_webhook_events", "meeting_recordings", "meeting_brand_links"]),
  meetingCols: new Set(["transcript_status", "transcript_attempts", "transcript_next_try",
    "recording_share_url", "recording_files_count", "match_method", "match_candidates"]),
  fail: { enqueue: false, claim: false, transcriptSave: false, eventCount: false, meetingCount: false, failList: false },
  seq: 0,
};

function newMeeting(p: Partial<MeetingRow>): MeetingRow {
  return {
    id: `m${++db.seq}`, zoom_uuid: "", zoom_meeting_id: "", brand_id: null, topic: "", host_email: null,
    status: "unmatched", match_method: null, transcript: null, transcript_source: null,
    transcript_status: "none", transcript_attempts: 0, transcript_next_try: null, transcript_error: null,
    transcript_fetched_at: null, started_at: null, created_at: db.now, recording_files_count: 0,
    match_dismissed: false, ...p,
  };
}

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const a = args as (string | number | null)[];

    // ── 스키마 probe ──
    if (sql.includes("information_schema.tables")) {
      return [...db.tables].map((t) => ({ table_name: t }));
    }
    if (sql.includes("information_schema.columns")) {
      return [...db.meetingCols].map((c) => ({ column_name: c }));
    }

    // ── 웹훅 원장 ──
    if (sql.includes("INSERT INTO zoom_webhook_events")) {
      if (db.fail.enqueue) throw new Error("connection terminated unexpectedly");
      const [event, key, uuid] = a as (string | null)[];
      if (db.events.some((e) => e.dedupe_key === key)) return [];          // ON CONFLICT DO NOTHING
      const row: EventRow = {
        id: `e${++db.seq}`, event: event ?? "", dedupe_key: key!, zoom_uuid: uuid ?? null,
        payload: JSON.parse(String(a[4])), status: "queued", attempts: 0, error: null, received_at: db.now,
      };
      db.events.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("UPDATE zoom_webhook_events SET status='queued'") && sql.includes("status='processing' AND received_at <")) {
      const min = Number(a[0]);
      const hit = db.events.filter((e) => e.status === "processing" && e.received_at < db.now - min * 60_000);
      for (const e of hit) e.status = "queued";
      return hit.map((e) => ({ id: e.id }));
    }
    if (sql.includes("UPDATE zoom_webhook_events SET status='processing'")) {
      if (db.fail.claim) throw new Error("deadlock detected");
      const limit = Number(a[0]);
      const hit = db.events.filter((e) => ["queued", "failed"].includes(e.status) && e.attempts < 5).slice(0, limit);
      for (const e of hit) { e.status = "processing"; e.attempts++; }
      return hit.map((e) => ({ id: e.id, event: e.event, payload: e.payload, attempts: e.attempts }));
    }
    if (sql.includes("UPDATE zoom_webhook_events SET status='failed'")) {
      const e = db.events.find((x) => x.id === a[0]);
      if (e) { e.status = "failed"; e.error = String(a[1]); }
      return [];
    }
    if (sql.includes("UPDATE zoom_webhook_events SET status=$2")) {
      const e = db.events.find((x) => x.id === a[0]);
      if (e) { e.status = String(a[1]); e.error = String(a[2]); }
      return [];
    }
    if (sql.includes("UPDATE zoom_webhook_events SET status='queued', attempts=0")) {
      const e = db.events.find((x) => x.id === a[0]);
      if (!e) return [];
      e.status = "queued"; e.attempts = 0; e.error = null;
      return [{ id: e.id }];
    }
    if (sql.includes("FROM zoom_webhook_events") && sql.includes("max(received_at)")) {
      if (db.fail.eventCount) throw new Error("relation \"zoom_webhook_events\" does not exist");
      const last = db.events.length ? new Date(Math.max(...db.events.map((e) => e.received_at))).toISOString() : null;
      return [{
        last,
        queued: String(db.events.filter((e) => ["queued", "processing"].includes(e.status)).length),
        failed: String(db.events.filter((e) => e.status === "failed").length),
      }];
    }
    if (sql.includes("SELECT id, event, error, received_at::text")) {
      if (db.fail.failList) throw new Error("connection terminated unexpectedly");
      return db.events.filter((e) => e.status === "failed")
        .map((e) => ({ id: e.id, event: e.event, error: e.error, received_at: new Date(e.received_at).toISOString(), zoom_uuid: e.zoom_uuid }));
    }

    // ── 회의 ──
    if (sql.includes("SELECT id, brand_id, match_method FROM meetings WHERE zoom_uuid=")) {
      const m = db.meetings.find((x) => x.zoom_uuid === a[0]);
      return m ? [{ id: m.id, brand_id: m.brand_id, match_method: m.match_method }] : [];
    }
    if (sql.includes("UPDATE meetings SET topic=COALESCE(NULLIF($2,''),topic)")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      if (m) {
        if (a[1]) m.topic = String(a[1]);
        m.host_email = m.host_email ?? (a[2] as string | null);
        m.started_at = m.started_at ?? (a[3] ? Date.parse(String(a[3])) : null);
        if (["scheduled", "unmatched"].includes(m.status) && m.brand_id) m.status = "received";
      }
      return [];
    }
    if (sql.includes("FROM meetings") && sql.includes("status IN ('scheduled','no_show')")) return [];   // findBookings
    if (sql.includes("FROM brand_email_aliases")) return [];
    if (sql.includes("SELECT id FROM brands WHERE lower(email)=lower($1)")) {
      const b = db.brands.find((x) => (x.email ?? "").toLowerCase() === String(a[0]).toLowerCase());
      return b ? [{ id: b.id }] : [];
    }
    if (sql.includes("INSERT INTO meetings (brand_id, zoom_meeting_id, zoom_uuid")) {
      const row = newMeeting({
        brand_id: (a[0] as string | null) ?? null, zoom_meeting_id: String(a[1] ?? ""), zoom_uuid: String(a[2]),
        topic: String(a[3] ?? ""), host_email: (a[4] as string | null) ?? null,
        started_at: a[6] ? Date.parse(String(a[6])) : null,
        status: String(a[9]), match_method: (a[10] as string | null) ?? null,
      });
      db.meetings.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("INSERT INTO meeting_brand_links")) {
      if (!db.tables.has("meeting_brand_links")) throw new Error("relation \"meeting_brand_links\" does not exist");
      db.links.push({ meeting_id: String(a[0]), brand_id: (a[1] as string | null) ?? null, method: String(a[3]) });
      return [];
    }
    if (sql.includes("INSERT INTO meeting_recordings")) {
      if (!db.tables.has("meeting_recordings")) throw new Error("relation \"meeting_recordings\" does not exist");
      const [meetingId, uuid, fileId] = a as string[];
      const cur = db.recordings.find((r) => r.zoom_uuid === uuid && r.zoom_file_id === fileId);
      if (cur) cur.meeting_id = cur.meeting_id ?? meetingId;
      else db.recordings.push({ zoom_uuid: uuid, zoom_file_id: fileId, meeting_id: meetingId, collected: false });
      return [];
    }
    if (sql.includes("UPDATE meetings SET recording_files_count=")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      if (m) m.recording_files_count = db.recordings.filter((r) => r.meeting_id === m.id).length;
      return [];
    }
    if (sql.includes("SELECT transcript, transcript_source FROM meetings WHERE id=")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      return m ? [{ transcript: m.transcript, transcript_source: m.transcript_source }] : [];
    }
    if (sql.includes("UPDATE meetings SET transcript=$2, transcript_source='zoom'")) {
      if (db.fail.transcriptSave) throw new Error("value too long for type character varying");
      const m = db.meetings.find((x) => x.id === a[0]);
      if (m) {
        m.transcript = String(a[1]); m.transcript_source = "zoom"; m.transcript_status = "ready";
        m.transcript_fetched_at = db.now; m.transcript_error = null; m.transcript_next_try = null;
        if (["scheduled", "received", "transcribing"].includes(m.status)) m.status = "received";
      }
      return [];
    }
    if (sql.includes("UPDATE meeting_recordings SET collected=true")) {
      const r = db.recordings.find((x) => x.zoom_uuid === a[0] && x.zoom_file_id === a[1]);
      if (r) r.collected = true;
      return [];
    }
    if (sql.includes("UPDATE meetings SET transcript_status=CASE WHEN transcript_status='ready'")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      if (m) {
        if (m.transcript_status !== "ready") m.transcript_status = "pending";
        m.transcript_next_try = db.now + 20 * 60_000;
      }
      return [];
    }
    if (sql.includes("UPDATE meetings SET transcript_status='failed'")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      if (m) {
        m.transcript_status = "failed"; m.transcript_error = String(a[1]);
        m.transcript_attempts++; m.transcript_next_try = db.now + HOUR;
      }
      return [];
    }
    if (sql.includes("UPDATE meetings SET transcript_status='recording_only'")) {
      // COALESCE(started_at, created_at) 로 나이를 세는지가 핵심 — started_at 이 없어도 확정돼야 한다.
      const waitH = Number(a[0]), maxTry = Number(a[1]);
      const useCoalesce = sql.includes("COALESCE(started_at, created_at)");
      for (const m of db.meetings) {
        if (!["pending", "failed"].includes(m.transcript_status)) continue;
        if (m.transcript) continue;
        const age = useCoalesce ? (m.started_at ?? m.created_at) : m.started_at;
        if (age == null) continue;
        if (age >= db.now - waitH * HOUR) continue;
        if (m.transcript_attempts < maxTry) continue;
        m.transcript_status = "recording_only";
        m.transcript_error = m.transcript_error || "전사 파일이 생성되지 않음 — Zoom 오디오 자동 전사 설정·지원 언어·요금제 확인 필요";
      }
      return [];
    }
    if (sql.includes("SELECT id, zoom_uuid FROM meetings") && sql.includes("transcript_status IN ('pending','failed')")) {
      const maxTry = Number(a[1]);
      return db.meetings
        .filter((m) => ["pending", "failed"].includes(m.transcript_status) && !m.transcript
          && !m.zoom_uuid.startsWith("manual:") && !m.zoom_uuid.startsWith("ics:")
          && (m.transcript_next_try == null || m.transcript_next_try <= db.now)
          && m.transcript_attempts < maxTry)
        .slice(0, Number(a[0]))
        .map((m) => ({ id: m.id, zoom_uuid: m.zoom_uuid }));
    }
    if (sql.includes("UPDATE meetings SET transcript_status='pending', transcript_error=NULL")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      if (m) { m.transcript_status = "pending"; m.transcript_error = null; m.transcript_attempts++; m.transcript_next_try = db.now + 2 * HOUR; }
      return [];
    }
    if (sql.includes("UPDATE meetings SET transcript_status='ready'")) {           // markTranscriptReady
      const m = db.meetings.find((x) => x.id === a[0]);
      if (m) { m.transcript_status = "ready"; m.transcript_fetched_at = m.transcript_fetched_at ?? db.now; }
      return [];
    }
    if (sql.includes("UPDATE meetings SET transcript_status='pending', transcript_attempts=0")) {
      const m = db.meetings.find((x) => x.id === a[0]);
      if (!m) return [];
      m.transcript_status = "pending"; m.transcript_attempts = 0; m.transcript_error = null; m.transcript_next_try = db.now;
      return [{ id: m.id }];
    }
    if (sql.includes("FROM meetings") && sql.includes("max(transcript_fetched_at)")) {
      if (db.fail.meetingCount) throw new Error("column \"transcript_status\" does not exist");
      const fetched = db.meetings.map((m) => m.transcript_fetched_at).filter((v): v is number => v != null);
      return [{
        last: fetched.length ? new Date(Math.max(...fetched)).toISOString() : null,
        pending: String(db.meetings.filter((m) => m.transcript_status === "pending").length),
        rec_only: String(db.meetings.filter((m) => m.transcript_status === "recording_only").length),
        failed: String(db.meetings.filter((m) => m.transcript_status === "failed").length),
        unmatched: String(db.meetings.filter((m) => m.status === "unmatched" && !m.match_dismissed).length),
      }];
    }
    if (sql.includes("SELECT id, topic, transcript_status")) {
      return db.meetings.filter((m) => ["failed", "pending", "recording_only"].includes(m.transcript_status))
        .map((m) => ({ id: m.id, topic: m.topic, transcript_status: m.transcript_status, transcript_error: m.transcript_error, started_at: null }));
    }
    return [];
  };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    getPool: () => ({ connect: async () => ({ release: () => {} }) }),
    tx: async <T,>(fn: (c: { query: (s: string, a?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> }) => Promise<T>) =>
      fn({ query: async (s, ar = []) => { const rows = await run(s, ar as unknown[]); return { rows, rowCount: rows.length }; } }),
  };
});

// ── 가짜 Zoom API ──────────────────────────────────────────────
const zoom = { vtt: "" as string, dlOk: true, dlError: "다운로드 실패 401", recFiles: [] as unknown[], recOk: true };
vi.mock("../lib/zoom-api", async (orig) => {
  const real = await orig<typeof import("../lib/zoom-api")>();
  return {
    ...real,
    zoomApiConfigured: () => true,
    downloadZoomFile: async () => (zoom.dlOk ? { ok: true, text: zoom.vtt } : { ok: false, error: zoom.dlError }),
    getMeetingRecordings: async () => (zoom.recOk
      ? { ok: true, data: { recording_files: zoom.recFiles } }
      : { ok: false, error: "녹화 없음(404) — 삭제됐거나 아직 생성 전" }),
  };
});

import {
  enqueueZoomEvent, runZoomIngest, handleZoomEvent, getZoomIngestStatus, getZoomSchemaState,
  requeueZoomEvent, retryPendingTranscripts, dedupeKey,
  ZOOM_SCHEMA_MIGRATION, MAX_TRANSCRIPT_ATTEMPTS, TRANSCRIPT_WAIT_HOURS, STUCK_PROCESSING_MIN,
} from "../lib/zoom-ingest";
import { storedStage, STORED_STAGE_LABEL } from "../lib/zoom-backfill";

const UUID = "abcDEF123==";
const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
대표: 안녕하세요, 오늘 미팅 시작하겠습니다.

2
00:00:05.000 --> 00:00:08.000
고객: 네, 반갑습니다.
`;

const recEvent = (transcript: boolean) => ({
  event: transcript ? "recording.transcript_completed" : "recording.completed",
  event_ts: db.now,
  payload: {
    download_token: transcript ? "dl-token" : undefined,
    object: {
      uuid: UUID, id: 8812345678, topic: "무음 QA 회의", host_email: "host@dinostudio.kr",
      start_time: new Date(db.now).toISOString(), duration: 0, share_url: "https://zoom.us/rec/share/xyz",
      participants: [],
      recording_files: transcript
        ? [{ id: "f-t", file_type: "TRANSCRIPT", file_extension: "VTT", download_url: "https://x.zoom.us/rec/download/t" }]
        : [{ id: "f-mp4", file_type: "MP4", file_extension: "MP4" }, { id: "f-m4a", file_type: "M4A", file_extension: "M4A" }],
    },
  },
});

beforeEach(() => {
  db.now = Date.UTC(2026, 8, 26, 8, 0, 0);
  db.events = []; db.meetings = []; db.recordings = []; db.links = []; db.seq = 0;
  db.brands = [{ id: "brand-1", email: "lead@example.com" }];
  db.tables = new Set(["zoom_webhook_events", "meeting_recordings", "meeting_brand_links"]);
  db.meetingCols = new Set(["transcript_status", "transcript_attempts", "transcript_next_try",
    "recording_share_url", "recording_files_count", "match_method", "match_candidates"]);
  db.fail = { enqueue: false, claim: false, transcriptSave: false, eventCount: false, meetingCount: false, failList: false };
  zoom.vtt = VTT; zoom.dlOk = true; zoom.recFiles = []; zoom.recOk = true;
});

describe("웹훅 접수 — 실패를 200 으로 삼키지 않는다", () => {
  it("정상 접수는 큐에 들어간다", async () => {
    const r = await enqueueZoomEvent(recEvent(false));
    expect(r.queued).toBe(true);
    expect(db.events).toHaveLength(1);
  });
  it("같은 이벤트 재전송은 중복으로 구분한다(한 행만 남는다)", async () => {
    await enqueueZoomEvent(recEvent(false));
    const again = await enqueueZoomEvent(recEvent(false));
    expect(again.queued).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(db.events).toHaveLength(1);
  });
  it("저장 실패는 예외로 올린다 — '중복'으로 둔갑시키지 않는다(Zoom 재전송 가능)", async () => {
    db.fail.enqueue = true;
    await expect(enqueueZoomEvent(recEvent(false))).rejects.toThrow();
    expect(db.events).toHaveLength(0);
  });
  it("녹화 파일 구성이 다르면 다른 이벤트로 본다", () => {
    expect(dedupeKey(recEvent(false))).not.toBe(dedupeKey(recEvent(true)));
  });
});

describe("녹화 → 전사 수집", () => {
  it("녹화만 오면 회의·파일을 기록하고 전사 대기로 둔다", async () => {
    const out = await handleZoomEvent(recEvent(false));
    expect(out.handled).toBe(true);
    expect(out.note).toContain("전사 대기");
    const m = db.meetings[0];
    expect(m.zoom_uuid).toBe(UUID);
    expect(m.transcript_status).toBe("pending");
    expect(m.recording_files_count).toBe(2);           // MP4 + M4A
  });
  it("전사 이벤트로 본문이 저장되고 파이프라인 진입 상태가 된다", async () => {
    await handleZoomEvent(recEvent(false));
    db.meetings[0].brand_id = "brand-1";
    db.meetings[0].status = "received";
    const out = await handleZoomEvent(recEvent(true));
    expect(out.note).toContain("전사 수집 완료");
    const m = db.meetings[0];
    expect(m.transcript_status).toBe("ready");
    expect(m.transcript).toContain("안녕하세요");
    expect(m.status).toBe("received");                 // 후처리 워커가 집어가는 상태
    expect(db.recordings.find((r) => r.zoom_file_id === "f-t")!.collected).toBe(true);
  });
  it("전사 저장이 실패하면 '수집 완료'로 보고하지 않고 실패로 남긴다", async () => {
    await handleZoomEvent(recEvent(false));
    db.fail.transcriptSave = true;
    await expect(handleZoomEvent(recEvent(true))).rejects.toThrow(/전사 저장 실패/);
    expect(db.meetings[0].transcript_status).toBe("failed");
    expect(db.meetings[0].transcript).toBeNull();
  });
  it("사람이 넣은 전사는 덮어쓰지 않는다", async () => {
    await handleZoomEvent(recEvent(false));
    db.meetings[0].transcript = "담당자가 직접 정리한 전사";
    db.meetings[0].transcript_source = "manual";
    const out = await handleZoomEvent(recEvent(true));
    expect(out.note).toContain("보존");
    expect(db.meetings[0].transcript).toBe("담당자가 직접 정리한 전사");
  });
});

describe("워커 — 실패 전파와 재시도", () => {
  it("큐 조회가 실패하면 '0건 성공'으로 답하지 않는다", async () => {
    db.fail.claim = true;
    await expect(runZoomIngest()).rejects.toThrow();
  });
  it("처리 중 오류는 failed 로 남아 다음 회차에 다시 집어간다", async () => {
    await enqueueZoomEvent(recEvent(false));
    db.tables.delete("meeting_recordings");            // 파일 저장 실패 상황
    const r = await runZoomIngest();
    expect(r.failed).toBe(1);
    expect(r.done).toBe(0);
    expect(db.events[0].status).toBe("failed");
    expect(db.events[0].error).toContain("meeting_recordings");
  });
  it("'processing' 에 갇힌 건은 일정 시간 뒤 큐로 돌아온다", async () => {
    await enqueueZoomEvent(recEvent(false));
    db.events[0].status = "processing";
    db.now += (STUCK_PROCESSING_MIN + 1) * 60_000;
    const r = await runZoomIngest();
    expect(r.requeuedStuck).toBe(1);
    expect(r.done).toBe(1);
  });
  it("재처리 대상이 없으면 성공으로 보고하지 않는다", async () => {
    expect(await requeueZoomEvent("없는-id")).toBe(false);
  });
});

describe("무음·전사 미생성 회의 — 무한 대기로 남지 않는다", () => {
  it("전사가 끝내 오지 않으면 재시도 상한 뒤 '녹음만 있음'으로 확정된다", async () => {
    await handleZoomEvent(recEvent(false));            // MP4+M4A 만, 전사 없음
    zoom.recFiles = [{ id: "f-mp4", file_type: "MP4" }];   // API 로 봐도 전사 없음
    expect(db.meetings[0].transcript_status).toBe("pending");

    // 백오프를 따라 상한까지 재시도가 돌아간다.
    for (let i = 0; i < MAX_TRANSCRIPT_ATTEMPTS + 1; i++) {
      db.now += 3 * HOUR;
      await retryPendingTranscripts();
    }
    expect(db.meetings[0].transcript_attempts).toBeGreaterThanOrEqual(MAX_TRANSCRIPT_ATTEMPTS);

    // 대기 시간까지 지나면 확정 표시되어 대기함에서 빠진다.
    db.now += (TRANSCRIPT_WAIT_HOURS + 1) * HOUR;
    await retryPendingTranscripts();
    expect(db.meetings[0].transcript_status).toBe("recording_only");
    expect(db.meetings[0].transcript_error).toContain("전사");
  });

  it("started_at 이 비어도 확정된다 — 예전엔 영구히 '전사 대기'로 남았다", async () => {
    db.meetings.push(newMeeting({
      zoom_uuid: "noStart==", transcript_status: "pending",
      transcript_attempts: MAX_TRANSCRIPT_ATTEMPTS, started_at: null,
      created_at: db.now - (TRANSCRIPT_WAIT_HOURS + 2) * HOUR,
    }));
    await retryPendingTranscripts();
    expect(db.meetings[0].transcript_status).toBe("recording_only");
  });

  it("확정 전에는 대기 건수로 보이고, 확정 뒤에는 '녹음만 있음'으로 집계된다", async () => {
    await handleZoomEvent(recEvent(false));
    let st = await getZoomIngestStatus();
    expect(st.pendingTranscripts).toBe(1);
    expect(st.recordingOnly).toBe(0);
    db.meetings[0].transcript_attempts = MAX_TRANSCRIPT_ATTEMPTS;
    db.now += (TRANSCRIPT_WAIT_HOURS + 1) * HOUR;
    zoom.recFiles = [];
    await retryPendingTranscripts();
    st = await getZoomIngestStatus();
    expect(st.pendingTranscripts).toBe(0);
    expect(st.recordingOnly).toBe(1);
  });
});

describe("상태 카드 — 오류를 0/연동됨으로 숨기지 않는다", () => {
  it("정상이면 건수가 숫자로 온다", async () => {
    await enqueueZoomEvent(recEvent(false));
    const st = await getZoomIngestStatus();
    expect(st.schema.ready).toBe(true);
    expect(st.errors).toEqual([]);
    expect(st.queued).toBe(1);
    expect(st.receiving).toBe(true);
  });
  it("웹훅이 한 번도 안 왔으면 '수신 중'이 아니다", async () => {
    const st = await getZoomIngestStatus();
    expect(st.receiving).toBe(false);
    expect(st.lastEventAt).toBeNull();
  });
  it("조회가 실패하면 건수를 0 이 아니라 null 로 두고 사유를 남긴다", async () => {
    db.fail.eventCount = true;
    db.fail.meetingCount = true;
    const st = await getZoomIngestStatus();
    expect(st.queued).toBeNull();
    expect(st.pendingTranscripts).toBeNull();
    expect(st.unmatched).toBeNull();
    expect(st.errors.length).toBe(2);
    expect(st.receiving).toBe(false);
  });
  it("0097 미적용이면 그 사실과 없는 항목을 적는다(전부 0 + 연동됨 금지)", async () => {
    db.tables.delete("zoom_webhook_events");
    db.meetingCols.delete("transcript_status");
    const st = await getZoomIngestStatus();
    expect(st.schema.ready).toBe(false);
    expect(st.schema.missing).toContain("zoom_webhook_events");
    expect(st.schema.missing).toContain("meetings.transcript_status");
    expect(st.errors.join(" ")).toContain(ZOOM_SCHEMA_MIGRATION);
    expect(st.queued).toBeNull();                    // 스키마가 없으면 세지 않는다
  });
  it("환경변수 입력 여부와 실제 수신은 별개로 보고한다", async () => {
    const st = await getZoomIngestStatus();
    expect(st.envSet).toBe(true);                    // 자격정보 "입력됨"
    expect(st.receiving).toBe(false);                // 그래도 아직 수신 이력은 없다
  });
  it("스키마 probe 는 없는 표·컬럼만 집어낸다", async () => {
    db.meetingCols.delete("match_candidates");
    const s = await getZoomSchemaState();
    expect(s.ready).toBe(false);
    expect(s.missing).toEqual(["meetings.match_candidates"]);
  });
});

describe("과거 가져오기 표기 — 일정만 등록된 건을 '수집됨'으로 적지 않는다", () => {
  it("단계별로 구분한다", () => {
    expect(storedStage(null)).toBe("none");
    expect(storedStage({ id: "m1", files: 0, has_transcript: false, transcript_status: "none" })).toBe("scheduled");
    expect(storedStage({ id: "m1", files: 2, has_transcript: false, transcript_status: "pending" })).toBe("recording");
    expect(storedStage({ id: "m1", files: 2, has_transcript: true, transcript_status: "ready" })).toBe("transcript");
    expect(storedStage({ id: "m1", files: 0, has_transcript: false, transcript_status: "ready" })).toBe("transcript");
  });
  it("라벨이 '일정만 등록'과 '전사 완료'를 구분한다", () => {
    expect(STORED_STAGE_LABEL.scheduled).toContain("일정만");
    expect(STORED_STAGE_LABEL.transcript).toContain("전사");
    expect(STORED_STAGE_LABEL.none).toBe("미수집");
  });
});

describe("미매핑 회의 — 나중에 매칭해도 파이프라인이 끊기지 않는다", () => {
  it("브랜드를 못 찾으면 unmatched 로 남고 전사만 채워진다(요약은 대기)", async () => {
    await handleZoomEvent(recEvent(false));
    expect(db.meetings[0].status).toBe("unmatched");
    await handleZoomEvent(recEvent(true));
    const m = db.meetings[0];
    expect(m.transcript_status).toBe("ready");
    expect(m.transcript).toContain("안녕하세요");
    // 미매핑인 채로 status 를 전진시키지 않는다 — 브랜드 없이 요약·후속이 나가면 안 된다.
    expect(m.status).toBe("unmatched");
    const st = await getZoomIngestStatus();
    expect(st.unmatched).toBe(1);
  });
});
