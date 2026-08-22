import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/auth";
import { runIntegrityChecks } from "@/lib/integrity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 데이터 정합성 점검(읽기 전용) — 고아 레코드·끊긴 링크 스캔.
//   GET /api/admin/integrity?token=<CRON_SECRET>  또는 exec/lead 세션.
// 쓰기 없음(SELECT count 만) — 안전하게 반복 호출 가능.

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = env.cronSecret;
  if (secret) {
    if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
    if (req.nextUrl.searchParams.get("token") === secret) return true;
  }
  const u = await currentUser().catch(() => null);
  return u?.role === "exec" || u?.role === "lead";
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runIntegrityChecks();
  return NextResponse.json({ ok: true, ...result });
}
