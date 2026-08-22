import { NextRequest, NextResponse } from "next/server";
import { applyMigrations, getMigrationState } from "@/lib/migrate";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 로컬 없이 스키마를 생성하기 위한 마이그레이션 엔드포인트.
//   POST /api/admin/migrate  (Authorization: Bearer <CRON_SECRET>)
//   또는 GET /api/admin/migrate?token=<CRON_SECRET>
//   상태만 확인: GET /api/admin/migrate?token=<CRON_SECRET>&mode=status  (적용 안 함)
// migrations/*.sql 을 순서대로 적용하고 schema_migrations 로 추적(재호출 안전).
// CRON_SECRET 미설정 시 거부(무보호 DDL 방지).

function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("token") === secret) return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized (CRON_SECRET 필요)" }, { status: 401 });
  }
  try {
    // mode=status: 적용하지 않고 적용/미적용 목록만 반환.
    if (req.nextUrl.searchParams.get("mode") === "status") {
      const state = await getMigrationState();
      return NextResponse.json({ ok: true, ...state });
    }
    const force = req.nextUrl.searchParams.get("force") === "1";
    const result = await applyMigrations(force);
    return NextResponse.json({ ok: true, force, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
