// Zoom 웹훅 수집 파이프라인 — 빠른 접수(원장 저장) → 워커에서 처리.
//   웹훅은 받자마자 zoom_webhook_events 에 넣고 200 을 돌려준다(재전송·지연 방지).
//   실제 처리(브랜드 매핑·전사 내려받기)는 워커에서 하며, 언제 다시 돌려도 안전하다.
//
//   녹화 완료와 전사 완료는 별개로 온다:
//     recording.completed            → 회의·녹화 파일 기록, 전사 없으면 pending(대기)
//     recording.transcript_completed → 전사 파일 내려받아 저장 → ready
//   전사가 끝내 오지 않으면(전사 기능·언어·요금제) 일정 시간 뒤 recording_only 로 표시한다.
import { query, queryOne } from "./db";
import { matchBrand, zoomIdFromUrl, type BookingRow } from "./zoom-match";
import { vttToTranscript, vttSpeakers } from "./zoom-vtt";
import { downloadZoomFile, downloadZoomFileWithS2S, getMeetingRecordings, zoomApiConfigured, type ZoomRecordingFile } from "./zoom-api";

export const TRANSCRIPT_FILE_TYPES = new Set(["TRANSCRIPT", "CC"]);

/**
 * 이미 있는 전사를 그대로 둘지 판단.
 *   사람이 직접 넣었거나 이전에 수집한 전사는 덮어쓰지 않는다(원문 보존·재처리 안전).
 *   비어 있거나 재수집 대상으로 표시된 것만 새로 채운다.
 */
export function keepExistingTranscript(cur: { transcript?: string | null; transcript_source?: string | null } | null): boolean {
  const t = (cur?.transcript ?? "").trim();
  if (!t) return false;
  return cur?.transcript_source !== "zoom_retry";
}
/** 녹화만 오고 전사가 이만큼 지나도 안 오면 "녹음만 있음"으로 표시한다. */
export const TRANSCRIPT_WAIT_HOURS = 24;
export const MAX_TRANSCRIPT_ATTEMPTS = 6;

export interface ZoomEventPayload {
  event?: string;
  event_ts?: number;
  /**
   * 녹화 다운로드 토큰 — Zoom 이벤트 본문의 **최상위**(event·payload 와 같은 레벨)에 온다.
   * payload 안에서만 찾으면 토큰이 누락돼 전사 다운로드가 401 로 실패한다.
   */
  download_token?: string;
  payload?: {
    plainToken?: string;
    /** 예전 표기 대비용 — 최상위 값이 없을 때만 본다. */
    download_token?: string;
    object?: {
      uuid?: string; id?: number | string; topic?: string; host_email?: string; host_id?: string;
      start_time?: string; duration?: number; share_url?: string; timezone?: string;
      participants?: { name?: string; email?: string }[];
      registrant_email?: string;
      recording_files?: ZoomRecordingFile[];
    };
  };
}

/**
 * 이벤트에서 다운로드 토큰 꺼내기 — 최상위가 정식 위치다.
 *   원장(zoom_webhook_events.payload)에는 이벤트 전체가 저장되므로,
 *   재처리 때도 같은 토큰을 다시 꺼내 쓸 수 있다(발급 후 약 24시간 유효).
 */
export function eventDownloadToken(evt: ZoomEventPayload): string | null {
  const t = (evt.download_token ?? evt.payload?.download_token ?? "").trim();
  return t || null;
}

/** 이벤트 고유키 — 같은 웹훅 재전송을 한 행으로 묶는다(회의 인스턴스 + 파일 식별자까지). */
export function dedupeKey(evt: ZoomEventPayload): string {
  const o = evt.payload?.object ?? {};
  const files = (o.recording_files ?? []).map((f) => f.id ?? `${f.file_type ?? ""}:${f.recording_start ?? ""}`).sort().join(",");
  return [evt.event ?? "", o.uuid ?? "", files].join("|");
}

/**
 * 웹훅 접수 — 원장에 넣기만 한다(빠른 200 응답).
 *   · 이미 접수된 같은 이벤트면 ON CONFLICT DO NOTHING 으로 행이 없다 → duplicate.
 *   · 저장 자체가 실패하면 예외를 그대로 올린다. 호출자(웹훅 라우트)는 5xx 로 답해
 *     Zoom 이 재전송하게 해야 한다 — 200 으로 삼키면 그 회의는 영구히 사라진다.
 */
export async function enqueueZoomEvent(evt: ZoomEventPayload): Promise<{ queued: boolean; id?: string; duplicate?: boolean }> {
  const key = dedupeKey(evt);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO zoom_webhook_events (event, dedupe_key, zoom_uuid, event_ts, payload)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [evt.event ?? "", key, evt.payload?.object?.uuid ?? null, evt.event_ts ?? null, JSON.stringify(evt)],
  );
  if (!row) return { queued: false, duplicate: true };
  return { queued: true, id: row.id };
}

export interface ZoomRunResult {
  processed: number; done: number; failed: number; skipped: number; transcriptsRetried: number;
  requeuedStuck: number;
  /** 처리 결과를 원장에 적지 못한 건 — 조용히 넘기지 않고 호출자·화면에 알린다. */
  bookkeepingErrors: string[];
}

/** 워커가 중간에 죽으면 'processing' 에 남는다 — 일정 시간 지난 건은 큐로 되돌린다. */
export const STUCK_PROCESSING_MIN = 15;

/** 대기 중인 웹훅 이벤트 처리 + 전사 재시도. 크론에서 호출(여러 번 돌아도 안전). */
export async function runZoomIngest(limit = 20): Promise<ZoomRunResult> {
  const res: ZoomRunResult = {
    processed: 0, done: 0, failed: 0, skipped: 0, transcriptsRetried: 0,
    requeuedStuck: 0, bookkeepingErrors: [],
  };
  // 배포·타임아웃으로 'processing' 에 갇힌 건 회수 — 조회 실패는 숨기지 않는다.
  const stuck = await query<{ id: string }>(
    `UPDATE zoom_webhook_events SET status='queued'
      WHERE status='processing' AND received_at < now() - ($1 || ' minutes')::interval
      RETURNING id`, [STUCK_PROCESSING_MIN]);
  res.requeuedStuck = stuck.length;

  // 큐 조회 실패를 빈 배열로 감추면 "0건 성공"으로 보고돼 장애가 묻힌다 — 예외를 올린다.
  const rows = await query<{ id: string; event: string; payload: ZoomEventPayload; attempts: number }>(
    `UPDATE zoom_webhook_events SET status='processing', attempts=attempts+1
      WHERE id IN (SELECT id FROM zoom_webhook_events
                    WHERE status IN ('queued','failed') AND attempts < 5
                    ORDER BY received_at LIMIT $1)
      RETURNING id, event, payload, attempts`, [limit]);

  for (const r of rows) {
    res.processed++;
    let out: { handled: boolean; note: string } | null = null;
    let err: string | null = null;
    try { out = await handleZoomEvent(r.payload); }
    catch (e) { err = (e as Error).message; }

    try {
      if (err != null) {
        await query("UPDATE zoom_webhook_events SET status='failed', error=$2, processed_at=now() WHERE id=$1",
          [r.id, err.slice(0, 300)]);
        res.failed++;
      } else {
        await query("UPDATE zoom_webhook_events SET status=$2, error=$3, processed_at=now() WHERE id=$1",
          [r.id, out!.handled ? "done" : "skipped", out!.note.slice(0, 300)]);
        if (out!.handled) res.done++; else res.skipped++;
      }
    } catch (e) {
      // 결과를 적지 못하면 그 건은 'processing' 에 남아 위 회수 로직이 다시 집어간다.
      res.bookkeepingErrors.push(`이벤트 결과 기록 실패: ${(e as Error).message.slice(0, 120)}`);
      if (err != null) res.failed++;
    }
  }
  res.transcriptsRetried = await retryPendingTranscripts();
  return res;
}

/** 이벤트 1건 처리. */
export async function handleZoomEvent(evt: ZoomEventPayload): Promise<{ handled: boolean; note: string }> {
  const o = evt.payload?.object;
  if (!o?.uuid) return { handled: false, note: "회의 UUID 없음" };

  switch (evt.event) {
    case "recording.completed":
      return upsertFromRecording(evt, false);
    case "recording.transcript_completed":
      return upsertFromRecording(evt, true);
    default:
      return { handled: false, note: `처리 대상 아닌 이벤트(${evt.event ?? "?"})` };
  }
}

/** 녹화/전사 이벤트 → 회의 행 확보 → 파일 기록 → (전사면) 본문 수집. */
async function upsertFromRecording(evt: ZoomEventPayload, isTranscriptEvent: boolean): Promise<{ handled: boolean; note: string }> {
  const o = evt.payload!.object!;
  const uuid = o.uuid!;
  const zoomMeetingId = o.id != null ? String(o.id) : null;
  const startedAt = o.start_time ?? null;
  const files = o.recording_files ?? [];

  const meeting = await ensureMeetingRow({
    uuid, zoomMeetingId, topic: o.topic ?? "", hostEmail: o.host_email ?? null,
    startedAt, duration: o.duration ?? null, shareUrl: o.share_url ?? null,
    participants: o.participants ?? (o.registrant_email ? [{ email: o.registrant_email }] : []),
  });

  // 파일 목록 기록 — 같은 파일이 다시 와도 UNIQUE(zoom_uuid, zoom_file_id) 로 중복 저장되지 않는다.
  //   저장이 실패하면 예외를 올린다(이벤트는 failed 로 남고 워커가 다시 집어간다).
  for (const f of files) await recordFile(meeting.id, uuid, f);
  await query("UPDATE meetings SET recording_files_count=(SELECT count(*) FROM meeting_recordings WHERE meeting_id=$1) WHERE id=$1",
    [meeting.id]);

  const transcriptFile = files.find((f) => TRANSCRIPT_FILE_TYPES.has((f.file_type ?? "").toUpperCase()));
  if (transcriptFile) {
    const got = await collectTranscript(meeting.id, uuid, transcriptFile, eventDownloadToken(evt));
    // 실패를 done 으로 닫으면 원장의 다운로드 토큰을 다시 쓸 수 없다 —
    //   failed 로 남겨 워커가 다시 집고, 실패 목록에도 보이게 한다.
    if (!got.ok) throw new Error(got.note);
    return { handled: true, note: got.note };
  }

  if (isTranscriptEvent) {
    // 전사 완료 이벤트인데 파일이 안 왔다 — API 로 한 번 더 확인(늦은 반영 대비).
    const again = await fetchTranscriptViaApi(meeting.id, uuid);
    return { handled: true, note: again.note };
  }

  // 녹화만 도착 — 전사 대기로 둔다. 이미 전사가 있으면 건드리지 않는다.
  await query(
    `UPDATE meetings SET transcript_status=CASE WHEN transcript_status='ready' THEN 'ready' ELSE 'pending' END,
       transcript_next_try=now() + interval '20 minutes'
     WHERE id=$1`, [meeting.id]);
  return { handled: true, note: "녹화 수집 · 전사 대기" };
}

interface EnsureInput {
  uuid: string; zoomMeetingId: string | null; topic: string; hostEmail: string | null;
  startedAt: string | null; duration: number | null; shareUrl: string | null;
  participants: { name?: string; email?: string }[];
}

/**
 * 회의 행 확보. 순서:
 *   1) 같은 UUID 행이 이미 있으면 그 행(이벤트 역순 도착에도 한 회의로 모인다)
 *   2) 없으면 브랜드 매핑을 판정하고, 예약으로 만들어 둔 행이 있으면 그 행을 이 회차로 승격
 *   3) 그것도 없으면 새 행 생성
 * 수동으로 정해 둔 브랜드(match_method='manual')는 절대 덮어쓰지 않는다.
 */
async function ensureMeetingRow(input: EnsureInput): Promise<{ id: string; brandId: string | null }> {
  const existing = await queryOne<{ id: string; brand_id: string | null; match_method: string | null }>(
    "SELECT id, brand_id, match_method FROM meetings WHERE zoom_uuid=$1", [input.uuid]).catch(() => null);

  if (existing) {
    await query(
      `UPDATE meetings SET topic=COALESCE(NULLIF($2,''),topic), host_email=COALESCE(host_email,$3),
         started_at=COALESCE(started_at,$4), duration_min=COALESCE(duration_min,$5),
         recording_share_url=COALESCE($6,recording_share_url),
         status=CASE WHEN status IN ('scheduled','unmatched') AND brand_id IS NOT NULL THEN 'received' ELSE status END
       WHERE id=$1`,
      [existing.id, input.topic, input.hostEmail, input.startedAt, input.duration, input.shareUrl]);
    return { id: existing.id, brandId: existing.brand_id };
  }

  // 참석자 이메일 → 브랜드 후보(보조 근거)
  const emailBrandIds: string[] = [];
  for (const p of input.participants) {
    if (!p.email) continue;
    if (input.hostEmail && p.email.toLowerCase() === input.hostEmail.toLowerCase()) continue;
    const b = await brandByEmail(p.email);
    if (b) emailBrandIds.push(b);
  }

  // 같은 숫자 회의 ID 로 잡아둔 예약들(브랜드 지정된 것만)
  const bookings = input.zoomMeetingId ? await findBookings(input.zoomMeetingId) : [];
  const m = matchBrand({ zoomMeetingId: input.zoomMeetingId, startedAt: input.startedAt, bookings, emailBrandIds });

  // 예약 행이 있으면 그 행을 이번 회차로 쓴다 — 예약 때 남긴 브랜드·제목·담당자를 잇는다.
  if (m.bookingMeetingId) {
    await query(
      `UPDATE meetings SET zoom_uuid=$2, zoom_meeting_id=COALESCE(NULLIF($3,''),zoom_meeting_id),
         topic=COALESCE(NULLIF($4,''),topic), host_email=COALESCE(host_email,$5),
         started_at=COALESCE($6,started_at), duration_min=COALESCE(duration_min,$7),
         recording_share_url=$8, status='received',
         match_method='booking', match_note=$9, match_candidates='[]'::jsonb
       WHERE id=$1`,
      [m.bookingMeetingId, input.uuid, input.zoomMeetingId ?? "", input.topic, input.hostEmail,
       input.startedAt, input.duration, input.shareUrl, m.reason]);
    await logBrandLink(m.bookingMeetingId, m.brandId, null, "booking", m.reason, "system:zoom");
    return { id: m.bookingMeetingId, brandId: m.brandId };
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO meetings (brand_id, zoom_meeting_id, zoom_uuid, topic, host_email, participants,
       started_at, scheduled_at, duration_min, recording_share_url, status,
       match_method, match_note, match_candidates, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,'zoom-webhook')
     RETURNING id`,
    [m.brandId, input.zoomMeetingId ?? "", input.uuid, input.topic, input.hostEmail,
     JSON.stringify(input.participants), input.startedAt, input.duration, input.shareUrl,
     m.brandId ? "received" : "unmatched", m.method, m.reason, JSON.stringify(m.candidates)]);
  if (!row) throw new Error("회의 저장 실패");
  await logBrandLink(row.id, m.brandId, null, m.method, m.reason, "system:zoom");
  return { id: row.id, brandId: m.brandId };
}

/** 같은 숫자 회의 ID 를 가진 "브랜드가 지정된" 예약 행들. */
async function findBookings(zoomMeetingId: string): Promise<BookingRow[]> {
  return query<BookingRow>(
    `SELECT id, brand_id, topic, scheduled_at::text AS scheduled_at, zoom_join_url, zoom_meeting_id
       FROM meetings
      WHERE brand_id IS NOT NULL
        AND status IN ('scheduled','no_show')
        AND (zoom_meeting_id=$1 OR zoom_join_url LIKE '%/j/' || $1 || '%')
      ORDER BY scheduled_at DESC LIMIT 20`, [zoomMeetingId]).catch(() => []);
}

async function brandByEmail(email: string): Promise<string | null> {
  const alias = await queryOne<{ brand_id: string }>(
    "SELECT brand_id FROM brand_email_aliases WHERE lower(email)=lower($1) LIMIT 1", [email]).catch(() => null);
  if (alias) return alias.brand_id;
  const b = await queryOne<{ id: string }>(
    "SELECT id FROM brands WHERE lower(email)=lower($1) LIMIT 1", [email]).catch(() => null);
  return b?.id ?? null;
}

async function logBrandLink(meetingId: string, brandId: string | null, prev: string | null, method: string, reason: string, by: string): Promise<void> {
  await query(
    `INSERT INTO meeting_brand_links (meeting_id, brand_id, prev_brand_id, method, reason, by_admin)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [meetingId, brandId, prev, method, reason.slice(0, 400), by])
    .catch((e) => {
      // 감사 기록 실패로 회의 저장 자체를 되돌리지는 않는다(재처리 시 이력이 중복 생성됨).
      //   대신 조용히 버리지 않고 남긴다 — 0097 미적용이면 상태 카드에서 함께 드러난다.
      console.error("[zoom] 매핑 이력 기록 실패:", (e as Error).message);
    });
}

/** 녹화 파일 1건 기록(중복 무시). 다운로드 토큰이 붙은 URL 은 저장하지 않는다. */
async function recordFile(meetingId: string, uuid: string, f: ZoomRecordingFile): Promise<void> {
  const fileId = f.id ?? `${f.file_type ?? "FILE"}:${f.recording_start ?? ""}`;
  await query(
    `INSERT INTO meeting_recordings (meeting_id, zoom_uuid, zoom_file_id, file_type, recording_type,
       file_extension, file_size, play_url, recording_start, recording_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (zoom_uuid, zoom_file_id) DO UPDATE SET meeting_id=COALESCE(meeting_recordings.meeting_id, EXCLUDED.meeting_id)`,
    [meetingId, uuid, fileId, (f.file_type ?? "").toUpperCase(), f.recording_type ?? "",
     (f.file_extension ?? "").toUpperCase(), f.file_size ?? null, f.play_url ?? null,
     f.recording_start ?? null, f.recording_end ?? null]);
}

/** 전사 파일 내려받아 meetings.transcript 에 저장. 수동으로 적어둔 전사는 덮어쓰지 않는다. */
async function collectTranscript(meetingId: string, uuid: string, f: ZoomRecordingFile, downloadToken: string | null):
  Promise<{ ok: boolean; note: string }> {
  const cur = await queryOne<{ transcript: string | null; transcript_source: string | null }>(
    "SELECT transcript, transcript_source FROM meetings WHERE id=$1", [meetingId]).catch(() => null);
  // 사람이 넣었거나 이미 Zoom 전사가 들어온 회의는 다시 덮지 않는다(재처리 안전).
  if (keepExistingTranscript(cur)) {
    await markTranscriptReady(meetingId);
    return { ok: true, note: "이미 전사 있음 — 보존" };
  }
  if (!f.download_url) return { ok: false, note: "전사 다운로드 주소 없음" };

  // 주소와 토큰은 반드시 짝이 맞아야 한다.
  //   · 웹훅이 준 주소 → 웹훅이 준 download_token (S2S 토큰을 쓰면 401)
  //   · API 로 새로 받은 주소 → S2S 액세스 토큰
  const dl = downloadToken
    ? await downloadZoomFile(f.download_url, { kind: "webhook", token: downloadToken })
    : await downloadZoomFileWithS2S(f.download_url);
  if (!dl.ok || !dl.text) {
    await failTranscript(meetingId, dl.error ?? "전사 다운로드 실패");
    return { ok: false, note: dl.error ?? "전사 다운로드 실패" };
  }
  const text = vttToTranscript(dl.text);
  if (!text.trim()) {
    await failTranscript(meetingId, "전사 파일이 비어 있음");
    return { ok: false, note: "전사 파일이 비어 있음" };
  }
  const speakers = vttSpeakers(dl.text);
  // 본문 저장이 실패하면 "수집 완료"라고 답해선 안 된다 — 실패를 남기고 예외를 올린다.
  //   status: 미매핑(unmatched) 회의는 그대로 둔다. 담당자가 브랜드를 연결할 때
  //   파이프라인 진입 상태(received)로 전진시켜 요약·후속 초안이 이어진다.
  try {
    await query(
      `UPDATE meetings SET transcript=$2, transcript_source='zoom', transcript_status='ready',
         transcript_fetched_at=now(), transcript_error=NULL, transcript_next_try=NULL,
         status=CASE WHEN status IN ('scheduled','received','transcribing') THEN 'received' ELSE status END
       WHERE id=$1`, [meetingId, text]);
  } catch (e) {
    const msg = `전사 저장 실패 — ${(e as Error).message}`;
    await failTranscript(meetingId, msg).catch(() => {});
    throw new Error(msg);
  }
  await query(
    "UPDATE meeting_recordings SET collected=true, collected_at=now() WHERE zoom_uuid=$1 AND zoom_file_id=$2",
    [uuid, f.id ?? ""]);
  return { ok: true, note: `전사 수집 완료(${text.length}자${speakers.length ? ` · 화자 ${speakers.length}명` : ""})` };
}

async function markTranscriptReady(meetingId: string): Promise<void> {
  await query(
    `UPDATE meetings SET transcript_status='ready', transcript_fetched_at=COALESCE(transcript_fetched_at,now()),
       transcript_error=NULL, transcript_next_try=NULL WHERE id=$1`, [meetingId]);
}

async function failTranscript(meetingId: string, err: string): Promise<void> {
  // 지수 백오프(20분 → 최대 12시간).
  await query(
    `UPDATE meetings SET transcript_status='failed', transcript_error=$2,
       transcript_attempts=transcript_attempts+1,
       transcript_next_try=now() + (least(720, 20 * power(2, least(transcript_attempts,5))) || ' minutes')::interval
     WHERE id=$1`, [meetingId, err.slice(0, 300)]).catch(() => {});
}

/** API 로 전사 파일을 다시 찾아 수집(웹훅 토큰 만료·늦은 반영 대비). */
export async function fetchTranscriptViaApi(meetingId: string, uuid: string): Promise<{ ok: boolean; note: string }> {
  const r = await getMeetingRecordings(uuid);
  if (!r.ok) {
    await failTranscript(meetingId, r.error ?? "녹화 조회 실패");
    return { ok: false, note: r.error ?? "녹화 조회 실패" };
  }
  const files = r.data?.recording_files ?? [];
  for (const f of files) await recordFile(meetingId, uuid, f);
  const t = files.find((f) => TRANSCRIPT_FILE_TYPES.has((f.file_type ?? "").toUpperCase()));
  if (!t) {
    await query(
      `UPDATE meetings SET transcript_status='pending', transcript_error=NULL,
         transcript_attempts=transcript_attempts+1,
         transcript_next_try=now() + interval '2 hours' WHERE id=$1`, [meetingId]);
    return { ok: false, note: "아직 전사 파일 없음 — 대기" };
  }
  return collectTranscript(meetingId, uuid, t, null);
}

/**
 * 전사 대기·실패 회의 재시도.
 *   · 예정 시각이 된 것만(백오프)
 *   · 너무 오래 기다린 녹화는 "녹음만 있음"으로 확정 표시해 대기함이 계속 쌓이지 않게 한다.
 */
export async function retryPendingTranscripts(limit = 10): Promise<number> {
  // 오래 기다린 건 → recording_only 로 확정(전사 기능·언어·요금제 문제로 안 나오는 경우).
  //   조회·갱신 실패는 숨기지 않는다 — 크론 응답이 5xx 가 되어 장애가 드러나야 한다.
  await query(
    `UPDATE meetings SET transcript_status='recording_only',
       transcript_error=COALESCE(NULLIF(transcript_error,''), '전사 파일이 생성되지 않음 — Zoom 오디오 자동 전사 설정·지원 언어·요금제 확인 필요')
      WHERE transcript_status IN ('pending','failed')
        AND (transcript IS NULL OR transcript='')
        -- started_at 이 없는 회의도 나이를 먹어야 한다. NULL 이면 영구히 '전사 대기'로 남아
        -- 무음·전사 미생성 회의가 대기함에 계속 쌓였다(무한 대기 방지).
        AND COALESCE(started_at, created_at) < now() - ($1 || ' hours')::interval
        AND transcript_attempts >= $2`, [TRANSCRIPT_WAIT_HOURS, MAX_TRANSCRIPT_ATTEMPTS]);

  if (!zoomApiConfigured()) return 0;
  const rows = await query<{ id: string; zoom_uuid: string }>(
    `SELECT id, zoom_uuid FROM meetings
      WHERE transcript_status IN ('pending','failed')
        AND (transcript IS NULL OR transcript='')
        AND zoom_uuid NOT LIKE 'manual:%' AND zoom_uuid NOT LIKE 'ics:%'
        AND (transcript_next_try IS NULL OR transcript_next_try <= now())
        AND transcript_attempts < $2
      ORDER BY transcript_next_try NULLS FIRST LIMIT $1`, [limit, MAX_TRANSCRIPT_ATTEMPTS]);
  let n = 0;
  for (const r of rows) {
    // 1건의 실패가 나머지 재시도를 막지 않게 건별로 격리하되, 원인은 남긴다.
    await fetchTranscriptViaApi(r.id, r.zoom_uuid)
      .catch((e) => { console.error("[zoom] 전사 재시도 실패:", (e as Error).message); return null; });
    n++;
  }
  return n;
}

// ── 운영 화면용 ───────────────────────────────────────────────

/** 0097 이 만드는 것들 — 하나라도 없으면 수집 파이프라인이 동작할 수 없다. */
export const ZOOM_SCHEMA_TABLES = ["zoom_webhook_events", "meeting_recordings", "meeting_brand_links"] as const;
export const ZOOM_SCHEMA_MEETING_COLS = [
  "transcript_status", "transcript_attempts", "transcript_next_try",
  "recording_share_url", "recording_files_count", "match_method", "match_candidates",
] as const;
export const ZOOM_SCHEMA_MIGRATION = "0097_zoom_transcript_ingest.sql";

export interface ZoomSchemaState {
  ready: boolean;
  /** 없는 표·컬럼 이름. 비어 있으면 적용 완료. */
  missing: string[];
  /** 스키마 조회 자체가 실패한 경우의 사유(이때 ready 는 false, missing 은 비어 있다). */
  error?: string;
}

/** 0097 적용 여부를 실제 스키마에서 확인한다 — "적용됐다고 가정"하지 않는다. */
export async function getZoomSchemaState(): Promise<ZoomSchemaState> {
  try {
    const tables = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`, [[...ZOOM_SCHEMA_TABLES]]);
    const cols = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='meetings' AND column_name = ANY($1::text[])`,
      [[...ZOOM_SCHEMA_MEETING_COLS]]);
    const haveT = new Set(tables.map((r) => r.table_name));
    const haveC = new Set(cols.map((r) => r.column_name));
    const missing = [
      ...ZOOM_SCHEMA_TABLES.filter((t) => !haveT.has(t)),
      ...ZOOM_SCHEMA_MEETING_COLS.filter((c) => !haveC.has(c)).map((c) => `meetings.${c}`),
    ];
    return { ready: missing.length === 0, missing };
  } catch (e) {
    return { ready: false, missing: [], error: (e as Error).message.slice(0, 200) };
  }
}

export interface ZoomIngestStatus {
  // ① 환경변수 입력 여부 — "입력됨"이 곧 "동작함"은 아니다.
  envSet: boolean;
  webhookSecretSet: boolean;
  // ② 스키마(0097) 적용 여부.
  schema: ZoomSchemaState;
  // ③ 실제 수신 여부 — 웹훅이 한 번이라도 도착했는지.
  receiving: boolean;
  lastEventAt: string | null; lastTranscriptAt: string | null;
  /** 건수 — 조회에 실패하면 0 이 아니라 null 이다(0 건과 구분). */
  queued: number | null; failedEvents: number | null;
  pendingTranscripts: number | null; recordingOnly: number | null;
  failedTranscripts: number | null; unmatched: number | null;
  /** 조회 실패 사유 — 비어 있지 않으면 화면은 "확인 실패"로 표시해야 한다. */
  errors: string[];
}

/**
 * 수집 상태 — DB 오류를 빈 값이나 성공으로 숨기지 않는다.
 *   실패하면 건수는 null 로 두고 사유를 errors 에 담는다(전부 0 + "연동됨" 오표시 방지).
 *   ③ 실제 API 호출 성공 여부는 별도 검증(verifyZoomApi)으로만 판단한다 — 여기서 외부 호출을 하지 않는다.
 */
export async function getZoomIngestStatus(): Promise<ZoomIngestStatus> {
  const { env } = await import("./env");
  const errors: string[] = [];
  const schema = await getZoomSchemaState();
  if (schema.error) errors.push(`스키마 확인 실패 — ${schema.error}`);
  else if (!schema.ready) errors.push(`${ZOOM_SCHEMA_MIGRATION} 미적용 — 없는 항목: ${schema.missing.join(", ")}`);

  let ev: { last: string | null; queued: string; failed: string } | null = null;
  let mt: { last: string | null; pending: string; rec_only: string; failed: string; unmatched: string } | null = null;

  if (schema.ready) {
    try {
      ev = await queryOne(
        `SELECT max(received_at)::text AS last,
                count(*) FILTER (WHERE status IN ('queued','processing'))::text AS queued,
                count(*) FILTER (WHERE status='failed')::text AS failed
           FROM zoom_webhook_events`);
    } catch (e) { errors.push(`웹훅 원장 조회 실패 — ${(e as Error).message.slice(0, 160)}`); }
    try {
      mt = await queryOne(
        `SELECT max(transcript_fetched_at)::text AS last,
                count(*) FILTER (WHERE transcript_status='pending')::text AS pending,
                count(*) FILTER (WHERE transcript_status='recording_only')::text AS rec_only,
                count(*) FILTER (WHERE transcript_status='failed')::text AS failed,
                count(*) FILTER (WHERE status='unmatched' AND NOT COALESCE(match_dismissed,false))::text AS unmatched
           FROM meetings`);
    } catch (e) { errors.push(`회의 상태 조회 실패 — ${(e as Error).message.slice(0, 160)}`); }
  }

  const n = (v: string | undefined, ok: boolean): number | null => (ok ? Number(v ?? 0) : null);
  return {
    envSet: zoomApiConfigured(),
    webhookSecretSet: Boolean(env.zoom.webhookSecret),
    schema,
    receiving: Boolean(ev?.last),
    lastEventAt: ev?.last ?? null,
    lastTranscriptAt: mt?.last ?? null,
    queued: n(ev?.queued, Boolean(ev)),
    failedEvents: n(ev?.failed, Boolean(ev)),
    pendingTranscripts: n(mt?.pending, Boolean(mt)),
    recordingOnly: n(mt?.rec_only, Boolean(mt)),
    failedTranscripts: n(mt?.failed, Boolean(mt)),
    unmatched: n(mt?.unmatched, Boolean(mt)),
    errors,
  };
}

export interface ZoomFailureRow {
  kind: "event" | "meeting";
  id: string; label: string; detail: string; at: string | null;
}
/** 실패·대기 내역(재처리 버튼용). */
export async function listZoomFailures(limit = 20): Promise<ZoomFailureRow[]> {
  const events = await query<{ id: string; event: string; error: string | null; received_at: string; zoom_uuid: string | null }>(
    `SELECT id, event, error, received_at::text AS received_at, zoom_uuid FROM zoom_webhook_events
      WHERE status='failed' ORDER BY received_at DESC LIMIT $1`, [limit]);
  // status='error' 도 함께 보여준다 — 요약 단계에서 멈춘 회의가 조용히 방치되지 않게.
  const meets = await query<{
    id: string; topic: string | null; transcript_status: string; transcript_error: string | null;
    status: string; error: string | null; started_at: string | null;
  }>(
    `SELECT id, topic, transcript_status, transcript_error, status, error, started_at::text AS started_at
       FROM meetings
      WHERE transcript_status IN ('failed','pending','recording_only') OR status='error'
      ORDER BY COALESCE(started_at, created_at) DESC LIMIT $1`, [limit]);
  return [
    ...events.map((e): ZoomFailureRow => ({
      kind: "event", id: e.id, label: `웹훅 ${e.event}`, detail: e.error ?? "처리 실패", at: e.received_at,
    })),
    ...meets.map((m): ZoomFailureRow => ({
      kind: "meeting", id: m.id,
      label: m.topic || "(제목 없음)",
      detail: m.status === "error" ? `요약 단계 실패 — ${m.error || "사유 미기록"}`
        : m.transcript_status === "pending" ? "전사 대기 중"
        : m.transcript_status === "recording_only" ? (m.transcript_error || "녹음만 있음 — 전사 없음")
        : (m.transcript_error || "전사 수집 실패"),
      at: m.started_at,
    })),
  ];
}

/**
 * 실패한 웹훅 이벤트 다시 처리 — 큐로 되돌린다(중복 저장은 구조상 막혀 있다).
 *   RETURNING 으로 "실제로 그 행이 있었는지"를 판단한다. 예전에는 UPDATE 결과 배열이
 *   비어도 참으로 읽혀 존재하지 않는 이벤트까지 성공으로 보고했다. 오류는 올린다.
 */
export async function requeueZoomEvent(eventId: string): Promise<boolean> {
  const r = await query<{ id: string }>(
    `UPDATE zoom_webhook_events SET status='queued', attempts=0, error=NULL
      WHERE id=$1 RETURNING id`, [eventId]);
  return r.length > 0;
}

/**
 * 이 회의의 웹훅 원장에서 "다운로드 토큰이 있는" 최신 이벤트를 큐로 되돌린다.
 *   웹훅 토큰은 웹훅이 준 주소와 짝이 맞으므로, 새 API 스코프 승인 없이도 전사를 복구할 수 있다.
 *   토큰 유효기간(약 24시간)이 지나면 실패하며, 그때는 API 경로(스코프 승인 필요)로만 가능하다.
 *   비밀값은 반환하지 않는다 — 어떤 이벤트를 되돌렸는지만 알린다.
 */
export async function requeueTranscriptEventForMeeting(meetingId: string):
  Promise<{ requeued: boolean; note: string }> {
  const m = await queryOne<{ zoom_uuid: string }>("SELECT zoom_uuid FROM meetings WHERE id=$1", [meetingId]);
  if (!m?.zoom_uuid) return { requeued: false, note: "회의 UUID 없음" };
  const rows = await query<{ id: string; event: string; payload: ZoomEventPayload; received_at: string }>(
    `SELECT id, event, payload, received_at::text AS received_at FROM zoom_webhook_events
      WHERE zoom_uuid=$1 AND event IN ('recording.completed','recording.transcript_completed')
      ORDER BY received_at DESC LIMIT 10`, [m.zoom_uuid]);
  const hit = rows.find((r) => eventDownloadToken(r.payload));
  if (!hit) return { requeued: false, note: "원장에 다운로드 토큰이 있는 웹훅 이벤트가 없습니다" };
  await query(
    "UPDATE zoom_webhook_events SET status='queued', attempts=0, error=NULL WHERE id=$1", [hit.id]);
  return { requeued: true, note: `웹훅 원장 재처리(${hit.event})` };
}

/**
 * 요약 단계에서 멈춘 회의(status='error')를 다시 후처리 대상으로 돌린다.
 *   전사는 이미 있으므로 다시 내려받지 않는다 — status 만 되돌려 다음 후처리 회차가 요약을 재시도한다.
 *   자동 무한 재시도는 하지 않는다(담당자가 누를 때만).
 */
export async function requeueMeetingSummary(meetingId: string): Promise<boolean> {
  const r = await query<{ id: string }>(
    `UPDATE meetings SET status='received', error=NULL
      WHERE id=$1 AND status='error' AND transcript IS NOT NULL AND transcript <> ''
      RETURNING id`, [meetingId]);
  return r.length > 0;
}

/** 회의 1건 전사 재수집 — 백오프를 지우고 즉시 대상에 올린다. */
export async function requeueMeetingTranscript(meetingId: string): Promise<boolean> {
  const r = await query<{ id: string }>(
    `UPDATE meetings SET transcript_status='pending', transcript_attempts=0,
       transcript_error=NULL, transcript_next_try=now() WHERE id=$1 RETURNING id`, [meetingId]);
  return r.length > 0;
}
