import { NextRequest, NextResponse } from "next/server";
import { submitSurveyResponse } from "@/lib/repo/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 공개 설문 응답 수신 (14-A) — 인증 불필요, 토큰이 곧 자격.
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  let body: { answers?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const answers = body.answers ?? {};
  if (typeof answers !== "object" || Array.isArray(answers)) {
    return NextResponse.json({ error: "answers 형식 오류" }, { status: 400 });
  }
  try {
    const ok = await submitSurveyResponse(token.trim(), answers);
    if (!ok) return NextResponse.json({ error: "설문을 찾을 수 없습니다" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
