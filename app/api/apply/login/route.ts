import { NextRequest, NextResponse } from "next/server";
import { verifyOnbLogin, makeOnbSession, ONB_COOKIE } from "@/lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 고객 온보딩 로그인 — 이메일 + 발급코드 검증 → onb_session 쿠키.
export async function POST(req: NextRequest) {
  const { email, code } = await req.json().catch(() => ({ email: "", code: "" }));
  const r = await verifyOnbLogin(email ?? "", code ?? "");
  if (!r.ok || !r.customerId) {
    return NextResponse.json({ ok: false, error: r.error ?? "로그인 실패" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ONB_COOKIE, makeOnbSession(r.customerId), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
