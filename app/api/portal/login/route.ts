import { NextRequest, NextResponse } from "next/server";
import { createInvite } from "@/lib/portal-db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 매직링크 요청 (16 §1) — 이메일 → invite 생성 → 링크 메일 발송.
//   존재 여부를 응답으로 노출하지 않음(항상 ok). 개발 편의로 RESEND 미설정 시 링크 반환.
export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({ email: "" }));
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "이메일을 입력하세요" }, { status: 400 });
  }
  const invite = await createInvite(email).catch(() => null);
  if (invite) {
    const link = `${env.adminUrl}/portal/verify?token=${invite.token}`;
    if (env.resend.apiKey) {
      await sendMagicLink(email, invite.brandName, link).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    // 개발/미설정: 링크를 직접 반환(운영에선 메일만).
    return NextResponse.json({ ok: true, devLink: link });
  }
  return NextResponse.json({ ok: true }); // 존재하지 않아도 동일 응답
}

async function sendMagicLink(to: string, brandName: string, link: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.resend.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.resend.from, to,
      subject: `[GloveK 포털] ${brandName} 로그인 링크`,
      html: `<p>${brandName} 포털 로그인 링크입니다 (30분 유효):</p><p><a href="${link}">${link}</a></p>`,
    }),
  });
}
