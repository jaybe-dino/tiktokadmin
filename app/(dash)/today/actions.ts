"use server";

// 오늘(today) 화면 전용 서버 액션.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { opsAssign } from "@/lib/ops";

/**
 * Slack 유입알림 카드 [담당 수락] — 현재 로그인 사용자를 영업 담당(owner_sales)으로 지정.
 * opsAssign 경유 → stage_history 감사 이력까지 기록.
 */
export async function acceptLeadAction(brandId: string): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const res = await opsAssign(
    { actor: `admin:${u.id}`, role: u.role },
    { brand_id: brandId, role: "owner_sales", admin_user_id: u.id },
  );
  revalidatePath("/today");
  revalidatePath(`/brand/${brandId}`);
  return res;
}
