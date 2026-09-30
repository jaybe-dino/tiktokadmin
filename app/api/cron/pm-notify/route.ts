import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { getPmNotifyConfig, runPmNotify } from "@/lib/pm-notify";
import { kstDay } from "@/lib/pm-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 담당자 내부 안내 워커 — 설정된 시각에만 해당 종류를 보낸다.
//   설정이 꺼져 있거나 수신자가 없으면 아무것도 보내지 않는다(사유만 돌려준다).
//   같은 기간·수신자 중복은 pm_notify_log 유니크가 막는다.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let cfg;
  try { cfg = await getPmNotifyConfig(); }
  catch (e) { return NextResponse.json({ ok: false, reason: "migration_pending", error: (e as Error).message.slice(0, 200) }); }

  const now = new Date();
  const k = new Date(now.getTime() + 9 * 3600_000);        // KST 벽시계
  const hour = k.getUTCHours(), minute = k.getUTCMinutes(), dow = k.getUTCDay();
  const today = kstDay(now);
  // 크론이 5분 간격이라 설정 시각과 5분 안에 맞으면 그 종류를 돌린다(중복은 원장이 막는다).
  const near = (h: number, m: number) => hour === h && minute >= m && minute < m + 5;

  const out: Record<string, unknown> = { ok: true, today, hour, minute };
  if (cfg.dailyEnabled && near(cfg.dailyHour, cfg.dailyMinute)) {
    out.daily = await runPmNotify("daily", { today });
  }
  if (cfg.weeklyEnabled && dow === cfg.weeklyWeekday && near(cfg.weeklyHour, cfg.weeklyMinute)) {
    out.weekly = await runPmNotify("weekly", { today });
  }
  return NextResponse.json(out);
}
export const GET = POST;
