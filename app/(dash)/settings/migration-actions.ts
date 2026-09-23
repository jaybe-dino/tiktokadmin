"use server";
// DB 마이그레이션 상태 조회 + 인앱 적용 — 대표(exec)만. DDL 이므로 최고권한 한정.
import { currentUser } from "@/lib/auth";
import { getMigrationState, applyMigrations, type MigrationState, type MigrationApplyResult } from "@/lib/migrate";
import { revalidatePath } from "next/cache";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

export async function getMigrationStateAction(): Promise<R<MigrationState>> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (u.role !== "exec") return { ok: false, error: "대표만 확인할 수 있습니다." };
  try { return { ok: true, data: await getMigrationState() }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function applyMigrationsAction(): Promise<R<MigrationApplyResult>> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (u.role !== "exec") return { ok: false, error: "대표만 적용할 수 있습니다." };
  try {
    const data = await applyMigrations(false);
    revalidatePath("/settings");
    return { ok: true, data };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * 고른 파일만 적용 — 필요한 변경만 올리고 관계없는 변경은 건드리지 않기 위함.
 *   예) 연속 안내만 쓰려면 0096_lead_sequence.sql 하나만 적용.
 */
export async function applySelectedMigrationsAction(names: string[]): Promise<R<MigrationApplyResult>> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (u.role !== "exec") return { ok: false, error: "대표만 적용할 수 있습니다." };
  const picked = (names ?? []).map((n) => String(n).trim()).filter(Boolean);
  if (picked.length === 0) return { ok: false, error: "적용할 파일을 선택하세요." };
  try {
    const data = await applyMigrations(false, picked);
    revalidatePath("/settings");
    return { ok: true, data };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
