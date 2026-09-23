import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runZoomIngest } from "@/lib/zoom-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Zoom 수집 워커 — 접수된 웹훅 이벤트 처리 + 전사 대기/실패 재시도.
//   웹훅이 응답 직후 처리에 실패했거나(배포 중 등) 전사가 늦게 생성된 건을 여기서 따라잡는다.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await runZoomIngest();
  return NextResponse.json({ ok: true, ...res });
}
export const GET = POST;
