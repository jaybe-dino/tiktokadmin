"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export interface InsightActionResult {
  ok: boolean;
  error?: string;
}

/**
 * 주간 자가학습 인사이트 제안 승인/보류.
 * "제안은 사람이 승인해야 반영됩니다" — 대표 리포트 판단이므로 파트장/대표만.
 * approved=true 승인 · approved=false 보류. 게이트 우회 직접 UPDATE 아님(권한 확인 후 승인 플래그만 기록).
 */
export async function setInsightApprovalAction(
  id: string,
  approved: boolean,
): Promise<InsightActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (u.role !== "lead" && u.role !== "exec") {
    return { ok: false, error: "권한 없음 (승인은 파트장/대표만)" };
  }
  if (!id) return { ok: false, error: "대상 인사이트가 없습니다." };
  try {
    await query("UPDATE insights SET approved=$2 WHERE id=$1", [id, approved]);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath("/insights");
  return { ok: true };
}
