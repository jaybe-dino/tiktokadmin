import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 리드 유입·자동발송 확인 — 메타/커넥터 리드가 실제로 들어왔는지 + 문자·메일이 나갔는지.
//   GET /api/admin/leadcheck?token=<CRON_SECRET>
//   민감정보 없이 요약만: 브랜드명·이메일/전화 마스킹·유입시각·안내발송 채널.
const mask = (s: string | null) => {
  if (!s) return null;
  if (s.includes("@")) { const [a, b] = s.split("@"); return `${a.slice(0, 2)}***@${b}`; }
  return s.length > 4 ? `${s.slice(0, 3)}***${s.slice(-2)}` : "***";
};

async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized (CRON_SECRET 필요)" }, { status: 401 });
  }
  try {
    // 최근 커넥터/메타 리드 (source=meta_ads) — 유입 + 안내발송 상태.
    const leads = await query<{
      brand_name: string; email: string | null; phone: string | null; source: string;
      created_at: string; welcome_sent_at: string | null; welcome_channels: string[] | null;
    }>(
      `SELECT brand_name, email, phone, source, created_at, welcome_sent_at, welcome_channels
         FROM brands
        WHERE source='meta_ads' OR id IN (
          SELECT brand_id FROM brand_sources WHERE source_ref LIKE 'leadhook:%' OR source_ref LIKE 'meta:%')
        ORDER BY created_at DESC NULLS LAST LIMIT 10`).catch(() => []);

    // 최근 leadhook 인입 이벤트 (성공/실패/멱등).
    const events = await query<{ idem_key: string; status: string; error: string | null; created_at: string }>(
      `SELECT idem_key, status, error, created_at FROM ingest_events
        WHERE idem_key LIKE 'leadhook:%' OR idem_key LIKE 'meta:%'
        ORDER BY created_at DESC LIMIT 10`).catch(() => []);

    return NextResponse.json({
      ok: true,
      recent_meta_leads: leads.map((l) => ({
        brand_name: l.brand_name,
        email: mask(l.email), phone: mask(l.phone),
        created_at: l.created_at,
        welcome_sent: Boolean(l.welcome_sent_at),
        welcome_channels: l.welcome_channels ?? [],
      })),
      recent_leadhook_events: events,
      hint: "recent_meta_leads 에 항목이 있으면 유입 성공. welcome_channels 에 sms/email 이 있으면 자동발송됨.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
