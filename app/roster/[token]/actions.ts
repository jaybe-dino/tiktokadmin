"use server";
// 외부 열람 인증. 비밀번호 확인과 로그아웃만 한다 — 이 경로에는 수정·삭제가 없다.
import { cookies } from "next/headers";
import { loginShare, logoutShare, ROSTER_COOKIE } from "@/lib/seminar-event-share";
import { SHARE_SESSION_HOURS } from "@/lib/seminar-events-model";

export async function rosterLoginAction(token: string, password: string):
  Promise<{ ok: boolean; error?: string }> {
  const r = await loginShare(token, password);
  if (!r.ok || !r.session) return { ok: false, error: r.error ?? "열람 정보가 올바르지 않습니다." };
  (await cookies()).set(ROSTER_COOKIE, r.session, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/roster", maxAge: SHARE_SESSION_HOURS * 3600,
  });
  return { ok: true };
}

export async function rosterLogoutAction(): Promise<{ ok: boolean }> {
  await logoutShare();
  return { ok: true };
}
