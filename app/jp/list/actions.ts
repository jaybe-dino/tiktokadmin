"use server";
// 일본 사전 신청 열람 — 코드 입력 → 서명 쿠키 발급(코드 자체는 쿠키에 담지 않는다).
import { cookies } from "next/headers";
import { JP_VIEW_COOKIE, checkJpCode, jpViewToken } from "@/lib/jp-apply";

export async function unlockJpListAction(code: string): Promise<{ ok: boolean; error?: string }> {
  if (!checkJpCode(code ?? "")) return { ok: false, error: "코드가 올바르지 않습니다." };
  (await cookies()).set(JP_VIEW_COOKIE, jpViewToken(), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/jp", maxAge: 60 * 60 * 8, // 8시간 — 공용 PC 에 오래 남지 않게
  });
  return { ok: true };
}

export async function lockJpListAction(): Promise<{ ok: boolean }> {
  (await cookies()).delete({ name: JP_VIEW_COOKIE, path: "/jp" });
  return { ok: true };
}
