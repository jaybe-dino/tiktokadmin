import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { importApplications } from "@/lib/tpartners-import";

// apply.tpartners.live 신청 행 이관. 토큰(CRON_SECRET) 보호. dry_run=1 이면 쓰기 없음.
//   POST /api/admin/import-tpartners?token=<CRON_SECRET>&dry_run=1
//   body: { applications: [ {tiktok_shop_applications 행...}, ... ] }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("token") === secret) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1" || req.nextUrl.searchParams.get("dry_run") === "true";

  let body: { applications?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const apps = Array.isArray(body.applications) ? (body.applications as Record<string, unknown>[]) : null;
  if (!apps) return NextResponse.json({ error: "applications 배열이 필요합니다." }, { status: 400 });

  try {
    const report = await importApplications(apps, { dryRun });
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
