"use server";
// 온보딩 파이프라인 수동 단계 이동(드래그앤드롭) — brands.onb_stage_override 설정/해제.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ONB_STAGES } from "@/lib/onboarding-pipeline";

const STAGE_KEYS = new Set<string>(ONB_STAGES.map((s) => s.key));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** stage=null(또는 "auto")이면 자동 파생으로 복귀, 아니면 해당 단계로 수동 고정. */
export async function setOnbStageAction(brandId: string, stage: string | null): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!UUID_RE.test(brandId)) return { ok: false, error: "잘못된 브랜드" };
  const reset = !stage || stage === "auto";
  if (!reset && !STAGE_KEYS.has(stage)) return { ok: false, error: "잘못된 단계" };
  try {
    if (reset) {
      await query("UPDATE brands SET onb_stage_override=NULL, onb_stage_override_at=NULL, updated_at=now() WHERE id=$1", [brandId]);
    } else {
      await query("UPDATE brands SET onb_stage_override=$2, onb_stage_override_at=now(), updated_at=now() WHERE id=$1", [brandId, stage]);
    }
    revalidatePath("/onboarding-pipeline");
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/onb_stage_override/.test(msg)) return { ok: false, error: "마이그레이션(0081) 적용이 필요합니다(관리자)." };
    return { ok: false, error: "단계 이동에 실패했습니다." };
  }
}
