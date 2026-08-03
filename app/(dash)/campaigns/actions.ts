"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import type { Role } from "@/lib/types";

export interface CampaignResult {
  ok: boolean;
  error?: string;
  made?: number;
}

function isLead(role: Role): boolean {
  return role === "lead" || role === "exec";
}

// page.tsx 의 세그먼트 카운트 기준과 동일한 brands WHERE 조건.
const SEGMENT_WHERE: Record<string, string> = {
  winback: "state = 'dropped'",
  seminar: "state = 'seminar' AND stage_entered_at < now() - interval '90 days'",
  expand:
    "state IN ('live_mall','live_onboarding') AND coalesce(array_length(countries,1),0) BETWEEN 1 AND 2",
  pastdue: "pay_status = 'past_due'",
};

const SEGMENT_TITLE: Record<string, string> = {
  winback: "윈백 — 드랍(예산·보류)",
  seminar: "세미나 미전환 90일+",
  expand: "운영중 국가추가 후보",
  pastdue: "past_due 재접촉",
};

/**
 * 헤더 "캠페인 초안 생성 (AI)" — 대상이 존재하는 세그먼트별로 draft 상태의
 * bulk_sends 행을 만든다. 생성된 초안은 아래 "승인 대기 캠페인"에 노출되며,
 * 마케팅 담당 승인(approveCampaignAction)을 거쳐야 발송(queued)된다.
 */
export async function generateAllDraftsAction(): Promise<CampaignResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };

  let made = 0;
  for (const [key, where] of Object.entries(SEGMENT_WHERE)) {
    const cnt = await queryOne<{ c: number }>(
      `SELECT count(*)::int AS c FROM brands WHERE ${where}`,
    ).catch(() => null);
    const total = Number(cnt?.c ?? 0);
    if (total === 0) continue;

    // 같은 세그먼트의 미승인 초안이 이미 있으면 중복 생성 안 함.
    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM bulk_sends
        WHERE status = 'draft' AND target_def->>'segment' = $1
        LIMIT 1`,
      [key],
    ).catch(() => null);
    if (dup) continue;

    await query(
      `INSERT INTO bulk_sends (title, target_kind, target_def, channel, body_md, status, total, created_by)
       VALUES ($1, 'filter', $2::jsonb, 'email', $3, 'draft', $4, $5)`,
      [
        `${SEGMENT_TITLE[key] ?? key} 캠페인`,
        JSON.stringify({ segment: key }),
        "AI 초안 — 검토 후 승인·발송하세요.",
        total,
        u.id,
      ],
    ).catch(() => {});
    made++;
  }

  revalidatePath("/campaigns");
  revalidatePath("/send");
  return { ok: true, made };
}

/**
 * "승인·예약" — draft 캠페인을 승인하여 발송 대기(queued)로 전이.
 * 기획 확정: 대량 발송은 담당 재량(활성 계정이면 가능) — 수신동의 게이트는 대상 산정에서 적용.
 */
export async function approveCampaignAction(id: string): Promise<CampaignResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };

  const row = await queryOne<{ id: string }>(
    `UPDATE bulk_sends
        SET status = 'queued',
            scheduled_at = coalesce(scheduled_at, now())
      WHERE id = $1 AND status = 'draft'
      RETURNING id`,
    [id],
  ).catch(() => null);

  if (!row) return { ok: false, error: "이미 처리되었거나 없는 캠페인입니다." };
  revalidatePath("/campaigns");
  revalidatePath("/send");
  return { ok: true };
}

/** "취소" — draft/queued 캠페인을 취소(canceled) 상태로. 파트장/대표만. */
export async function cancelCampaignAction(id: string): Promise<CampaignResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!isLead(u.role)) return { ok: false, error: "권한 없음 (파트장/대표만)" };

  const row = await queryOne<{ id: string }>(
    `UPDATE bulk_sends
        SET status = 'canceled'
      WHERE id = $1 AND status IN ('draft','queued')
      RETURNING id`,
    [id],
  ).catch(() => null);

  if (!row) return { ok: false, error: "취소할 수 없는 상태입니다." };
  revalidatePath("/campaigns");
  revalidatePath("/send");
  return { ok: true };
}

/**
 * 윈백 리스트 "메모" — 드랍 브랜드의 재접촉 메모(next_action)·예정일(due_date) 저장.
 * 시점 도래 시 담당 워크큐(/queue)에 올라온다.
 */
export async function saveWinbackMemoAction(
  brandId: string,
  nextAction: string,
  dueDate?: string,
): Promise<CampaignResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };

  await query("UPDATE brands SET next_action=$2, due_date=$3 WHERE id=$1", [
    brandId,
    nextAction.trim() || null,
    dueDate?.trim() || null,
  ]).catch(() => {});

  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}
