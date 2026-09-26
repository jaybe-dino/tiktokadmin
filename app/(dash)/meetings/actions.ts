"use server";

// meetings 화면 전용 서버액션. @/app/actions.ts 는 수정하지 않는다(충돌 방지).
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { ensureMeetingFollowup } from "@/lib/meetings";

export interface MeetingActionResult {
  ok: boolean;
  error?: string;
  /** 사람이 읽는 부가 결과(예: 후속 초안까지 만들어졌는지). */
  note?: string;
}

/** 미팅 일정 수동 추가 — 줌 자동수집과 별개로 캘린더에 예약 일정 등록(status='scheduled').
 *   scheduled_at 은 datetime-local(KST) 문자열. 줌 연동 미팅과 구분 위해 zoom_uuid=manual:<uuid>. */
export async function createMeetingAction(input: {
  brand_id?: string;
  topic: string;
  scheduled_at: string;   // "YYYY-MM-DDTHH:mm" (KST 로 해석)
  host_email?: string;
  duration_min?: number;
  zoom_join_url?: string;
}): Promise<MeetingActionResult & { id?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const topic = (input.topic ?? "").trim();
  if (!topic) return { ok: false, error: "미팅 제목을 입력하세요." };
  const raw = (input.scheduled_at ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return { ok: false, error: "일시를 선택하세요." };
  const scheduledAt = `${raw}:00+09:00`; // KST 로 저장

  let brandId: string | null = null;
  if (input.brand_id) {
    const b = await queryOne<{ id: string }>("SELECT id FROM brands WHERE id=$1", [input.brand_id]).catch(() => null);
    if (!b) return { ok: false, error: "존재하지 않는 브랜드입니다." };
    brandId = b.id;
  }
  const join = (input.zoom_join_url ?? "").trim();
  if (join && !/^https?:\/\//i.test(join)) return { ok: false, error: "줌 링크는 http(s):// 로 시작해야 합니다." };
  const dur = input.duration_min && input.duration_min > 0 ? Math.round(input.duration_min) : null;

  // admin_users.id 는 text(이메일). meetings.host_admin_id 는 uuid 이므로 이메일을 넣을 수 없다.
  // 작성자 식별은 text 컬럼 created_by 에 저장한다(수동 미팅 생성 실패 버그 수정).
  const row = await queryOne<{ id: string }>(
    `INSERT INTO meetings (brand_id, zoom_meeting_id, zoom_uuid, topic, scheduled_at, host_email, created_by, duration_min, zoom_join_url, status)
     VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8,'scheduled') RETURNING id`,
    [brandId, `manual:${randomUUID()}`, topic, scheduledAt, (input.host_email ?? "").trim() || null, u.id, dur, join || null],
  ).catch((e) => { console.error("[meetings] 생성 실패:", (e as Error).message); return null; });
  if (!row) return { ok: false, error: "미팅 생성 실패" };

  if (brandId) {
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'manual','contact_logged',$2,now())`,
      [brandId, JSON.stringify({ channel: "meeting", meeting_id: row.id, kind: "scheduled", by: `admin:${u.id}` })],
    ).catch(() => {});
    revalidatePath(`/brand/${brandId}`);
  }
  revalidatePath("/meetings");
  return { ok: true, id: row.id };
}

/** 미팅 취소 — 수동/예약 미팅을 취소 상태로. */
export async function cancelMeetingAction(meetingId: string): Promise<MeetingActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!meetingId?.trim()) return { ok: false, error: "미팅을 선택하세요." };
  await query("UPDATE meetings SET status='canceled' WHERE id=$1 AND status IN ('scheduled','received')", [meetingId]);
  revalidatePath("/meetings");
  return { ok: true };
}

/** 매칭 실패(unmatched·미매칭) 미팅을 브랜드에 수동 연결. brand_id 세팅 + 파이프라인 진입(received). */
/** 개별 미팅(일정) 완전 삭제 — 캘린더에서 제거. email_drafts.meeting_id 는 ON DELETE SET NULL. */
export async function deleteMeetingAction(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!meetingId) return { ok: false, error: "미팅 ID 누락" };
  const m = await queryOne<{ brand_id: string | null }>("SELECT brand_id FROM meetings WHERE id=$1", [meetingId]).catch(() => null);
  if (!m) return { ok: false, error: "미팅을 찾을 수 없습니다." };
  await query("DELETE FROM meetings WHERE id=$1", [meetingId]);
  revalidatePath("/meetings");
  if (m.brand_id) revalidatePath(`/brand/${m.brand_id}`);
  return { ok: true };
}

/** '매칭 필요' 목록에서 무시 — 미팅은 유지하고 목록에서만 제외(match_dismissed=true). */
export async function dismissMeetingMatchAction(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!meetingId) return { ok: false, error: "미팅 ID 누락" };
  const r = await query("UPDATE meetings SET match_dismissed=true WHERE id=$1", [meetingId]).catch((e) => {
    if (/match_dismissed/.test((e as Error).message)) throw new Error("마이그레이션(0063) 적용 필요");
    throw e;
  });
  void r;
  revalidatePath("/meetings");
  return { ok: true };
}

/** 무시 취소 — 다시 '매칭 필요' 목록으로 복원. */
export async function restoreMeetingMatchAction(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!meetingId) return { ok: false, error: "미팅 ID 누락" };
  await query("UPDATE meetings SET match_dismissed=false WHERE id=$1", [meetingId]).catch(() => {});
  revalidatePath("/meetings");
  return { ok: true };
}

/** 미팅↔브랜드 맵핑 해제 — brand_id 를 비우고 상태를 매칭필요(unmatched)로 되돌린다. */
export async function unmapMeetingBrandAction(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!meetingId) return { ok: false, error: "미팅 ID 누락" };
  const m = await queryOne<{ brand_id: string | null }>("SELECT brand_id FROM meetings WHERE id=$1", [meetingId]).catch(() => null);
  if (!m) return { ok: false, error: "미팅을 찾을 수 없습니다." };
  await query(
    "UPDATE meetings SET brand_id=NULL, status=CASE WHEN status='received' THEN 'unmatched' ELSE status END WHERE id=$1",
    [meetingId],
  );
  revalidatePath("/meetings");
  if (m.brand_id) revalidatePath(`/brand/${m.brand_id}`);
  return { ok: true };
}

export async function connectMeetingBrandAction(
  meetingId: string,
  brandId: string,
): Promise<MeetingActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!meetingId?.trim() || !brandId?.trim()) {
    return { ok: false, error: "미팅·브랜드를 선택하세요." };
  }

  // 존재하는 브랜드인지 검증(하드코딩·유령 ID 방지)
  const brand = await queryOne<{ id: string }>(
    "SELECT id FROM brands WHERE id=$1",
    [brandId],
  );
  if (!brand) return { ok: false, error: "존재하지 않는 브랜드입니다." };

  const meeting = await queryOne<{ id: string; status: string }>(
    "SELECT id, status FROM meetings WHERE id=$1",
    [meetingId],
  );
  if (!meeting) return { ok: false, error: "존재하지 않는 미팅입니다." };

  // 이전 브랜드를 남겨 이력에 기록한다(누가 무엇을 무엇으로 바꿨는지).
  const before = await queryOne<{ brand_id: string | null }>(
    "SELECT brand_id FROM meetings WHERE id=$1", [meetingId]).catch(() => null);

  // 브랜드 연결. unmatched 상태였다면 파이프라인 진입 상태(received)로 전진.
  //   수동 지정은 이후 자동 매핑이 덮어쓰지 않도록 match_method='manual' 로 고정한다.
  await query(
    `UPDATE meetings
        SET brand_id=$2,
            status=CASE WHEN status='unmatched' THEN 'received' ELSE status END,
            match_method='manual', match_note=$3, match_candidates='[]'::jsonb
      WHERE id=$1`,
    [meetingId, brandId, `담당자 수동 연결 (${u.id})`],
  ).catch(async () => {
    // 0097 미적용 DB — 매핑 근거 컬럼 없이 연결만.
    await query(
      `UPDATE meetings SET brand_id=$2,
          status=CASE WHEN status='unmatched' THEN 'received' ELSE status END
        WHERE id=$1`, [meetingId, brandId]);
  });

  await query(
    `INSERT INTO meeting_brand_links (meeting_id, brand_id, prev_brand_id, method, reason, by_admin)
     VALUES ($1,$2,$3,'manual',$4,$5)`,
    [meetingId, brandId, before?.brand_id ?? null,
     before?.brand_id ? "담당자가 브랜드를 정정" : "담당자가 미매핑 회의를 연결", u.id]).catch(() => {});

  // 접촉 기록(미팅) + 최근 접촉 시각 — 다른 화면과 동일한 원장 반영.
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
     VALUES ($1,'zoom','contact_logged',$2,now())`,
    [brandId, JSON.stringify({ channel: "meeting", meeting_id: meetingId, by: `admin:${u.id}` })],
  ).catch(() => {});
  await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [brandId]).catch(() => {});

  // 뒤늦게 연결한 회의에 요약이 이미 있으면 후속 초안이 누락된다 — 여기서 한 번 더 보장한다.
  //   (후처리 워커는 summary_md 가 있는 회의를 다시 집지 않는다. 초안만 만들고 발송은 하지 않는다.)
  const fu = await ensureMeetingFollowup(meetingId)
    .catch((e) => ({ drafted: false, reason: `후속 초안 확인 실패 — ${(e as Error).message}` }));

  revalidatePath("/meetings");
  revalidatePath(`/brand/${brandId}`);
  return { ok: true, note: fu.drafted ? "브랜드 연결 · 후속 메일 초안 생성" : undefined };
}
