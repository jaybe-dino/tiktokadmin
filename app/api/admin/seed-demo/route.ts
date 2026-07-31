import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { seedDemo } from "@/lib/demo-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 더미데이터 적재 (is_test=true). CRON_SECRET 보호.
//   GET /api/admin/seed-demo?token=<CRON_SECRET>[&force=1]
function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("token") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const r = await seedDemo(force);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
export const POST = GET;
