import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { getSeminarConfig, seminarSchemaState, buildSessionTargets, dispatchDue, upcomingSessionDate } from "@/lib/seminar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 주간 세미나 워커 — ① 다음 회차 대상 확정(새 신청 편입) ② 예정 시각이 지난 예약 발송.
//   발송 시각 판정은 예약 행(due_at)이 한다 → 설정에서 시각을 바꿔도 배포 없이 그대로 동작.
//   마스터 스위치가 꺼져 있으면 ②는 아무것도 보내지 않는다(예약은 그대로 둔다).
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const schema = await seminarSchemaState();
  if (!schema.ready) {
    // 마이그레이션 전이라도 크론이 시끄럽지 않게, 다만 상태는 그대로 알린다.
    return NextResponse.json({ ok: false, reason: "migration_pending", missing: schema.missing });
  }

  const cfg = await getSeminarConfig();
  const day = upcomingSessionDate(cfg);
  const build = await buildSessionTargets(day, "cron").catch((e) => ({ ok: false, error: (e as Error).message }));
  const dispatch = await dispatchDue(200, new Date(), "cron");
  return NextResponse.json({ ok: true, sessionDate: day, build, dispatch });
}
export const GET = POST;
