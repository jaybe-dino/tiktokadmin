"use server";
// Zoom 수집 운영 화면 — 상태 조회 · 안전한 재처리 · 과거 가져오기 미리보기.
//   ※ 과거 가져오기는 "미리보기"만 제공한다. 실제 수집은 담당자가 건별로 누를 때만 실행된다.
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import {
  getZoomIngestStatus, listZoomFailures, requeueZoomEvent, requeueMeetingTranscript,
  requeueMeetingSummary, requeueTranscriptEventForMeeting, runZoomIngest, fetchTranscriptViaApi,
  type ZoomIngestStatus, type ZoomFailureRow,
} from "@/lib/zoom-ingest";
import { listUserRecordings, zoomApiConfigured } from "@/lib/zoom-api";
import { storedStage, type BackfillRow, type StoredProbe } from "@/lib/zoom-backfill";
import { TRANSCRIPT_FILE_TYPES } from "@/lib/zoom-ingest";

function canEdit(role: string | undefined): boolean { return role === "lead" || role === "exec"; }

export async function zoomStatusAction():
  Promise<{ ok: boolean; status?: ZoomIngestStatus; failures?: ZoomFailureRow[]; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  // 상태 자체는 오류를 errors 로 담아 돌려준다. 실패 목록 조회가 깨지면 빈 목록으로 감추지 않는다.
  const status = await getZoomIngestStatus().catch((e) => {
    throw new Error(`상태 조회 실패 — ${(e as Error).message}`);
  });
  const failures = await listZoomFailures().catch((e) => {
    status.errors.push(`실패 목록 조회 실패 — ${(e as Error).message.slice(0, 160)}`);
    return [] as ZoomFailureRow[];
  });
  return { ok: true, status, failures };
}

/**
 * Zoom API 실제 동작 검증 — "환경변수 입력됨"과 "API 호출됨"을 구분한다.
 *   버튼을 누를 때만 외부 호출한다. 자격정보·토큰은 반환하지 않는다.
 */
export async function zoomVerifyApiAction(host?: string):
  Promise<{ ok: boolean; stage?: string; error?: string; needsApproval?: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  const { verifyZoomApi } = await import("@/lib/zoom-api");
  const r = await verifyZoomApi(host).catch((e) => ({
    ok: false as const, stage: "none" as const, error: `검증 실패 — ${(e as Error).message}`,
  }));
  return { ok: r.ok, stage: r.stage, error: r.error, needsApproval: "needsApproval" in r ? r.needsApproval : undefined };
}

/** 실패 이벤트·회의 전사 재처리. 같은 회의·파일은 중복 저장되지 않는다. */
export async function zoomRetryAction(kind: "event" | "meeting", id: string): Promise<{ ok: boolean; error?: string; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  try {
    if (kind === "event") {
      const ok = await requeueZoomEvent(id);
      if (!ok) return { ok: false, error: "이벤트를 찾을 수 없습니다." };
      const r = await runZoomIngest(5);
      const extra = r.bookkeepingErrors.length ? ` · 기록 실패 ${r.bookkeepingErrors.length}건` : "";
      return { ok: true, note: `재처리 — 완료 ${r.done} · 실패 ${r.failed} · 건너뜀 ${r.skipped}${extra}` };
    }
    const m = await queryOne<{ zoom_uuid: string; status: string }>(
      "SELECT zoom_uuid, status FROM meetings WHERE id=$1", [id]);
    if (!m) return { ok: false, error: "회의를 찾을 수 없습니다." };

    // 요약 단계에서 멈춘 회의는 전사를 다시 내려받을 일이 아니다 — 후처리만 다시 올린다.
    if (m.status === "error" && await requeueMeetingSummary(id)) {
      return { ok: true, note: "요약 재시도 대상으로 되돌렸습니다 — 다음 후처리 회차에 진행됩니다." };
    }
    if (m.zoom_uuid.startsWith("manual:") || m.zoom_uuid.startsWith("ics:")) {
      return { ok: false, error: "줌 녹화가 아닌 회의입니다(수동·캘린더 일정)." };
    }

    await requeueMeetingTranscript(id);

    // 1순위: 웹훅 원장 재처리 — 웹훅이 준 주소·토큰 짝을 그대로 다시 쓴다(새 API 스코프 불필요).
    const led = await requeueTranscriptEventForMeeting(id);
    if (led.requeued) {
      const run = await runZoomIngest(5);
      if (run.done > 0) return { ok: true, note: `${led.note} — 전사 수집 완료` };
      const why = await queryOne<{ transcript_status: string; transcript_error: string | null }>(
        "SELECT transcript_status, transcript_error FROM meetings WHERE id=$1", [id]).catch(() => null);
      return {
        ok: false,
        error: `${led.note} — ${why?.transcript_error || "전사 수집 실패"}`,
      };
    }

    // 2순위: API 재조회 — 주소를 새로 받아 S2S 토큰과 짝지어 쓴다(녹화 목록 스코프 승인 필요).
    const r = await fetchTranscriptViaApi(id, m.zoom_uuid);
    return {
      ok: r.ok,
      note: r.ok ? r.note : undefined,
      error: r.ok ? undefined : `${led.note} · API 경로: ${r.note}`,
    };
  } catch (e) {
    // 실패를 "재처리 완료"로 보고하지 않는다.
    return { ok: false, error: `재처리 실패 — ${(e as Error).message}` };
  }
}

/**
 * 과거 회의 가져오기 — 미리보기 전용(저장·수집 없음).
 *   호스트(Zoom 사용자 이메일/ID)와 날짜 범위로 어떤 회의가 들어올지 먼저 보여준다.
 */
export async function zoomBackfillPreviewAction(input: { host: string; from: string; to: string }):
  Promise<{ ok: boolean; error?: string; rows?: BackfillRow[]; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  if (!zoomApiConfigured()) return { ok: false, error: "Zoom API 미설정 — 환경변수(ZOOM_ACCOUNT_ID·CLIENT_ID·CLIENT_SECRET) 확인" };
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(input.from) || !ymd.test(input.to)) return { ok: false, error: "날짜를 YYYY-MM-DD 로 지정하세요." };
  if (!input.host.trim()) return { ok: false, error: "호스트(줌 계정 이메일)를 입력하세요." };

  const r = await listUserRecordings(input.host.trim(), input.from, input.to);
  if (!r.ok) return { ok: false, error: r.error };

  const rows: BackfillRow[] = [];
  for (const m of r.meetings ?? []) {
    if (!m.uuid) continue;
    const stored = await queryOne<StoredProbe & { brand_id: string | null }>(
      `SELECT id, brand_id, transcript_status,
              (transcript IS NOT NULL AND transcript <> '') AS has_transcript,
              (SELECT count(*) FROM meeting_recordings mr WHERE mr.meeting_id = meetings.id)::int AS files
         FROM meetings WHERE zoom_uuid=$1`, [m.uuid]).catch(() => null);
    const brand = stored?.brand_id
      ? await queryOne<{ brand_name: string }>("SELECT brand_name FROM brands WHERE id=$1", [stored.brand_id]).catch(() => null)
      : null;
    rows.push({
      uuid: m.uuid,
      zoomMeetingId: m.id != null ? String(m.id) : "",
      topic: m.topic ?? "",
      startTime: m.start_time ?? "",
      durationMin: Number(m.duration ?? 0),
      hasTranscript: (m.recording_files ?? []).some((f) => TRANSCRIPT_FILE_TYPES.has((f.file_type ?? "").toUpperCase())),
      stored: storedStage(stored),
      brandName: brand?.brand_name ?? null,
    });
  }
  return { ok: true, rows, note: `${rows.length}건 조회 — 아직 아무것도 저장하지 않았습니다.` };
}

/** 미리보기에서 고른 회의 1건만 실제 수집. 이미 있으면 전사만 다시 확인한다. */
export async function zoomBackfillOneAction(uuid: string): Promise<{ ok: boolean; error?: string; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  if (!uuid.trim()) return { ok: false, error: "회의를 선택하세요." };

  const { getMeetingRecordings } = await import("@/lib/zoom-api");
  const rec = await getMeetingRecordings(uuid);
  if (!rec.ok || !rec.data) return { ok: false, error: rec.error ?? "녹화 조회 실패" };

  // 웹훅과 같은 경로로 처리 — 중복·매핑 규칙이 한 곳에만 있도록.
  const { handleZoomEvent } = await import("@/lib/zoom-ingest");
  const out = await handleZoomEvent({
    event: "recording.completed",
    payload: { object: { ...rec.data, id: rec.data.id, uuid } },
  });
  return { ok: true, note: out.note };
}

/** 미매핑 검토함 상세 — 매핑 근거·후보를 함께 보여주기 위한 조회. */
export interface UnmatchedDetail {
  id: string; topic: string; started_at: string | null; host_email: string | null;
  match_note: string | null; candidates: { brand_id: string; why: string; brand_name?: string }[];
  transcript_status: string;
}
export async function unmatchedDetailAction(): Promise<{ ok: boolean; rows?: UnmatchedDetail[] }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  const rows = await query<{
    id: string; topic: string | null; started_at: string | null; host_email: string | null;
    match_note: string | null; match_candidates: { brand_id: string; why: string }[] | null; transcript_status: string;
  }>(
    `SELECT id, topic, started_at::text AS started_at, host_email, match_note, match_candidates, transcript_status
       FROM meetings
      WHERE status='unmatched' AND NOT COALESCE(match_dismissed,false)
      ORDER BY COALESCE(started_at, created_at) DESC LIMIT 50`).catch(() => []);
  const out: UnmatchedDetail[] = [];
  for (const r of rows) {
    const cands = [];
    for (const c of r.match_candidates ?? []) {
      const b = await queryOne<{ brand_name: string }>("SELECT brand_name FROM brands WHERE id=$1", [c.brand_id]).catch(() => null);
      cands.push({ ...c, brand_name: b?.brand_name });
    }
    out.push({
      id: r.id, topic: r.topic ?? "", started_at: r.started_at, host_email: r.host_email,
      match_note: r.match_note, candidates: cands, transcript_status: r.transcript_status,
    });
  }
  return { ok: true, rows: out };
}
