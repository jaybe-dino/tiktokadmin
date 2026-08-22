"use server";
// 데이터 정합성 점검(읽기 전용) — 파트장·대표. 쓰기 없음이라 조회만 허용.
import { currentUser } from "@/lib/auth";
import { runIntegrityChecks, type IntegrityResult } from "@/lib/integrity";

export async function runIntegrityAction(): Promise<{ ok: true; data: IntegrityResult } | { ok: false; error: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (u.role !== "exec" && u.role !== "lead") return { ok: false, error: "파트장·대표만 확인할 수 있습니다." };
  try { return { ok: true, data: await runIntegrityChecks() }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}
