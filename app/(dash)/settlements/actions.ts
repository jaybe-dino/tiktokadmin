"use server";

// settlements 화면 전용 서버액션.
//  - 정산 런 실행: 활성 사이클 마감 + 정산 draft 생성(멱등) — 크론과 동일한 canonical 함수 경유.
//  - 정산 확정: draft → confirmed (파트장/대표 결재). approved_by 기록.
// @/app/actions.ts 는 수정하지 않고 이 화면 전용 액션만 여기에 둔다.

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export interface SettlementActionResult {
  ok: boolean;
  error?: string;
  created?: number;
  closed?: number;
}

// 파트장/대표(lead·exec) 게이트. currentUser 로 역할 확인.
async function requireLead(): Promise<{ actor: string } | null> {
  const u = await currentUser();
  if (!u || (u.role !== "lead" && u.role !== "exec")) return null;
  return { actor: `admin:${u.id}` };
}

// 정산 런 실행 — 활성 사이클 마감 후 정산 draft 자동 생성(UNIQUE brand_id,month 로 멱등).
// 크론(app/api/cron/cycle-close)과 동일한 closeCyclesAndDraftSettlements 경유. 확정은 별도(사람).
export async function runSettlementDraftAction(): Promise<SettlementActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const lead = await requireLead();
  if (!lead) return { ok: false, error: "권한 없음 (정산 런은 파트장/대표만)" };

  const { closeCyclesAndDraftSettlements } = await import("@/lib/operations");
  const res = await closeCyclesAndDraftSettlements();

  revalidatePath("/settlements");
  return { ok: true, created: res.settlements, closed: res.closed };
}

// 정산 확정 — draft → confirmed. 파트장/대표 결재 게이트, draft 상태에서만 허용, approved_by 스탬프.
export async function confirmSettlementAction(id: string): Promise<SettlementActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const lead = await requireLead();
  if (!lead) return { ok: false, error: "권한 없음 (확정은 파트장/대표만)" };
  if (!id) return { ok: false, error: "정산 ID 누락" };

  const cur = await queryOne<{ status: string; brand_id: string }>(
    "SELECT status, brand_id::text FROM settlements WHERE id=$1",
    [id],
  ).catch(() => null);
  if (!cur) return { ok: false, error: "정산 건을 찾을 수 없습니다." };
  if (cur.status !== "draft") {
    return { ok: false, error: `'${cur.status}' 상태는 확정할 수 없습니다 (draft 만 가능).` };
  }

  await query(
    "UPDATE settlements SET status='confirmed', approved_by=$2 WHERE id=$1 AND status='draft'",
    [id, lead.actor],
  );

  revalidatePath("/settlements");
  revalidatePath(`/brand/${cur.brand_id}`);
  return { ok: true };
}
