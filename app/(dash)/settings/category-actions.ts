"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { addBrandCategory, removeBrandCategory } from "@/lib/brand-categories";

interface Res { ok: boolean; error?: string }

/** 카테고리 추가 (파트장·대표). */
export async function addBrandCategoryAction(name: string): Promise<Res> {
  const u = await currentUser();
  if (!u || (u.role !== "lead" && u.role !== "exec")) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const n = (name ?? "").trim();
  if (!n) return { ok: false, error: "카테고리명을 입력하세요." };
  try {
    await addBrandCategory(n);
  } catch (e) {
    return { ok: false, error: /brand_categories/.test((e as Error).message) ? "마이그레이션(0069) 적용 필요" : (e as Error).message };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** 카테고리 삭제 (파트장·대표). */
export async function removeBrandCategoryAction(id: string): Promise<Res> {
  const u = await currentUser();
  if (!u || (u.role !== "lead" && u.role !== "exec")) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  await removeBrandCategory(id).catch(() => {});
  revalidatePath("/settings");
  return { ok: true };
}
