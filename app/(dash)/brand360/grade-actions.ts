"use server";
// 등급 5대 지표 보정 (기획 확정) — 담당자가 미팅 확인값으로 보정 → 등급 자동 재계산.
//   미입력(키 없음)과 미충족(false)을 구분. 판정 로직은 gradeFromChecks 단일 원천.
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { gradeFromChecks, type SelfChecks } from "@/lib/grade";

export type CheckValue = true | false | null; // null = 미입력
export type GradeChecksInput = Partial<Record<keyof SelfChecks, CheckValue>>;

export async function saveGradeChecksAction(
  brandId: string,
  checks: GradeChecksInput,
): Promise<{ ok: boolean; grade?: string; missing?: number; error?: string }> {
  const me = await currentUser();
  if (!me) return { ok: false, error: "세션 만료" };

  // 저장용: null(미입력)은 키 제거, true/false 만 보존
  const stored: Record<string, boolean> = {};
  for (const k of ["q1", "q2", "q3", "q4", "q5"] as const) {
    const v = checks[k];
    if (v === true || v === false) stored[k] = v;
  }
  const missing = 5 - Object.keys(stored).length;
  const grade = gradeFromChecks(stored as Partial<SelfChecks>);

  await query("UPDATE brands SET grade_checks=$2, grade=$3 WHERE id=$1",
    [brandId, JSON.stringify(stored), grade]);
  // 보정 이력(감사)
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
     VALUES ($1,'admin','grade_adjusted',$2,now())`,
    [brandId, JSON.stringify({ by: me.id, checks: stored, grade })]).catch(() => {});

  revalidatePath(`/brand/${brandId}`);
  return { ok: true, grade, missing };
}

export async function getGradeChecks(brandId: string): Promise<Record<string, boolean>> {
  const r = await queryOne<{ grade_checks: Record<string, boolean> }>(
    "SELECT grade_checks FROM brands WHERE id=$1", [brandId]).catch(() => null);
  return r?.grade_checks ?? {};
}
