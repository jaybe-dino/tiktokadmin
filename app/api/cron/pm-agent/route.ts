import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runPmBatch } from "@/lib/pm-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PM 에이전트 자동 점검 — 기존 보호된 cron 규약(Bearer CRON_SECRET / ?token=)을 그대로 쓴다.
//   · PM 을 켠(opt-in) 브랜드만, 테스트 브랜드 제외, 정해진 개수·시간 예산 안에서만 돈다.
//   · 외부 발송은 하지 않는다(제안·업무 생성까지만).
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.max(1, Math.min(20, Number(req.nextUrl.searchParams.get("limit") ?? 5)));
  try {
    const res = await runPmBatch(limit);
    return NextResponse.json({ ...res, ok: true });
  } catch (e) {
    // 실패를 성공으로 감추지 않는다.
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
export const GET = POST;
