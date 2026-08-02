"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export interface MonitorActionResult {
  ok: boolean;
  error?: string;
}

/**
 * 알림 수동 해소(조치 완료 처리).
 * 상태전이·발송·정산·결재가 아닌 운영 확인 동작이므로 게이트 대상 아님
 * (opsLogContact·email-link 도 동일하게 alerts.resolved_at 을 직접 갱신).
 * SLA 재검사에서 조건이 여전히 미해소면 upsertAlert 로 새 사이클 재생성됨.
 */
export async function resolveAlertAction(alertId: string): Promise<MonitorActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  await query(
    "UPDATE alerts SET resolved_at=now(), resolved_by=$2 WHERE id=$1 AND resolved_at IS NULL",
    [alertId, `admin:${u.id}`],
  );
  revalidatePath("/monitor");
  return { ok: true };
}
