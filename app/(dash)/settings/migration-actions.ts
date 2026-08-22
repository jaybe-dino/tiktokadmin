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
