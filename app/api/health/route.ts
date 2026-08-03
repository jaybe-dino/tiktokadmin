import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 헬스 체크 (17 §8) — DB·sync_state·큐(ingest 오류) 상태. 1분 업타임 체크용.
export async function GET() {
  const started = Date.now();
  const out: Record<string, unknown> = { ok: true, ts: new Date().toISOString() };

  try {
    await queryOne<{ one: number }>("SELECT 1 AS one");
    out.db = "up";
  } catch (e) {
    out.ok = false; out.db = "down"; out.dbError = (e as Error).message;
    return NextResponse.json(out, { status: 503 });
  }

  // sync_state 지연(각 소스 last_run)
  try {
    const sync = await query<{ source: string; last_run: string | null }>(
      "SELECT source, last_run FROM sync_state ORDER BY source");
    out.sync = sync;
  } catch { out.sync = "n/a"; }

  // ingest 최근 1시간 오류 누적(17 §6 runbook 신호)
  try {
    const err = await queryOne<{ n: string }>(
      "SELECT count(*)::text n FROM ingest_events WHERE status='error' AND created_at > now() - interval '1 hour'");
    out.ingestErrorsLastHour = Number(err?.n ?? 0);
  } catch { out.ingestErrorsLastHour = "n/a"; }

  // 연동 키 감지 여부(값 노출 없이 boolean 만) — 발송 안 될 때 배포/env 진단용
  out.integrations = {
    aligo: Boolean(env.aligo.apiKey && env.aligo.userId && env.aligo.sender),
    aligoTestMode: env.aligo.testMode,
    aligoProxy: Boolean(env.aligo.proxyUrl),
    resend: Boolean(env.resend.apiKey),
    anthropic: Boolean(env.anthropicKey),
    openai: Boolean(env.openaiKey),
    gmail: Boolean(env.gmail.saKeyJson),
    slack: Boolean(env.slack.botToken && env.slack.signingSecret),
    meta: Boolean(env.meta.verifyToken && env.meta.accessToken),
    zoom: Boolean(env.zoom.accountId && env.zoom.clientId && env.zoom.clientSecret),
  };

  out.latencyMs = Date.now() - started;
  return NextResponse.json(out);
}
