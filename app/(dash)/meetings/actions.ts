"use server";

// meetings 화면 전용 서버액션. @/app/actions.ts 는 수정하지 않는다(충돌 방지).
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export interface MeetingActionResult {
  ok: boolean;
  error?: string;
}

/** 매칭 실패(unmatched·미매칭) 미팅을 브랜드에 수동 연결. brand_id 세팅 + 파이프라인 진입(received). */
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

  // 브랜드 연결. unmatched 상태였다면 파이프라인 진입 상태(received)로 전진.
  await query(
    `UPDATE meetings
        SET brand_id=$2,
            status=CASE WHEN status='unmatched' THEN 'received' ELSE status END
      WHERE id=$1`,
    [meetingId, brandId],
  );

  // 접촉 기록(미팅) + 최근 접촉 시각 — 다른 화면과 동일한 원장 반영.
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
     VALUES ($1,'zoom','contact_logged',$2,now())`,
    [brandId, JSON.stringify({ channel: "meeting", meeting_id: meetingId, by: `admin:${u.id}` })],
  ).catch(() => {});
  await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [brandId]).catch(() => {});

  revalidatePath("/meetings");
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}
