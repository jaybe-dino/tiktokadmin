import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, canLogin, makeSessionValue, verifyLogin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/") || "/";

  const fail = (code: string) => {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", code);
    if (next && next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  };

  // 1차 게이트: env 화이트리스트 또는 활성 계정(admin_users). 2차: 비밀번호 검증.
  if (!(await canLogin(email))) return fail("not_allowed");
  if (!password) return fail("no_password");

  const r = await verifyLogin(email, password);
  if (!r.ok) return fail("bad_credentials");

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), { status: 303 });
  res.cookies.set(AUTH_COOKIE, makeSessionValue(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
