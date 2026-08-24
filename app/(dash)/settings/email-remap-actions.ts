"use server";
// 과거 메일함 재맵핑 — 파트장·대표. 미매칭 메일을 현재 브랜드 기준으로 재연결.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { unlinkedEmailStats, remapUnlinkedEmails, type RemapResult } from "@/lib/email-remap";

export async function emailRemapStatsAction(): Promise<{ ok: boolean; unlinked?: number; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (u.role !== "exec" && u.role !== "lead") return { ok: false, error: "파트장·대표만 확인할 수 있습니다." };
  try { const s = await unlinkedEmailStats(); return { ok: true, unlinked: s.unlinked }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function emailRemapRunAction(): Promise<RemapResult> {
  const u = await currentUser();
  if (!u) return { ok: false, scanned: 0, linked: 0, via: {}, remaining: 0, error: "세션 만료" };
  if (u.role !== "exec" && u.role !== "lead") return { ok: false, scanned: 0, linked: 0, via: {}, remaining: 0, error: "파트장·대표만 실행할 수 있습니다." };
  const r = await remapUnlinkedEmails();
  if (r.ok && r.linked > 0) revalidatePath("/");
  return r;
}
