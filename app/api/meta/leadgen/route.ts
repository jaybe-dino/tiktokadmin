import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { processIngest } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메타(페이스북) Lead Ads 웹훅 — 리드 폼 제출 → Graph API 로 상세 조회 → 원장 유입.
//   source='meta_ads' 로 들어가므로 자동 안내(welcome)·사전분석 대상에 자동 포함.
//   설정: developers.facebook.com 앱 → Webhooks → Page → leadgen 구독,
//         콜백 URL {ADMIN_URL}/api/meta/leadgen, Verify Token = META_VERIFY_TOKEN.
//   필요 env: META_VERIFY_TOKEN(내가 정한 값), META_PAGE_ACCESS_TOKEN(leads_retrieval),
//             META_APP_SECRET(서명 검증, 권장).

// ── 구독 검증(GET) ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("hub.mode") === "subscribe" && env.meta.verifyToken &&
      sp.get("hub.verify_token") === env.meta.verifyToken) {
    return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "verify_failed" }, { status: 403 });
}

// ── 수신(POST) ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // 서명 검증(META_APP_SECRET 설정 시)
  if (env.meta.appSecret) {
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    const expected = "sha256=" + createHmac("sha256", env.meta.appSecret).update(raw).digest("hex");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "bad_signature" }, { status: 403 });
    }
  }

  let body: { entry?: { changes?: { field: string; value: { leadgen_id?: string; page_id?: string } }[] }[] };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const results: unknown[] = [];
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen" || !ch.value?.leadgen_id) continue;
      const r = await handleLead(ch.value.leadgen_id).catch((e) => ({ error: (e as Error).message }));
      results.push({ leadgen_id: ch.value.leadgen_id, ...((r as object) ?? {}) });
    }
  }
  // 메타는 200 못 받으면 재시도 — 처리 실패해도 200(멱등키로 재수신 안전)
  return NextResponse.json({ ok: true, results });
}

/** Graph API 로 리드 상세 조회 → 공통 ingest(lead, meta_ads) 처리. */
async function handleLead(leadgenId: string): Promise<Record<string, unknown>> {
  if (!env.meta.accessToken) return { skipped: "META_PAGE_ACCESS_TOKEN 미설정" };

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${leadgenId}?fields=field_data,created_time,campaign_name,ad_name,form_id&access_token=${encodeURIComponent(env.meta.accessToken)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: (data as { error?: { message?: string } }).error?.message ?? "graph_fetch_failed" };

  // field_data: [{name:'email', values:['a@b.com']}, ...] — 흔한 필드명 매핑
  const fields: Record<string, string> = {};
  for (const f of (data.field_data ?? []) as { name: string; values?: string[] }[]) {
    fields[f.name.toLowerCase()] = f.values?.[0] ?? "";
  }
  const pick = (...names: string[]) => names.map((n) => fields[n]).find((v) => v?.trim()) ?? "";
  const email = pick("email", "이메일", "work_email");
  const phone = pick("phone_number", "phone", "전화번호", "연락처", "휴대폰번호").replace(/[^0-9+]/g, "");
  const brandName = pick("company_name", "회사명", "브랜드명", "brand", "company");
  const contactName = pick("full_name", "이름", "성함", "name", "담당자명");

  const result = await processIngest("lead", `meta:${leadgenId}`, {
    site: "manual",
    occurred_at: (data.created_time as string) || new Date().toISOString(),
    email: email || null,
    phone: phone || null,
    brand_name: brandName || null,
    contact_name: contactName || null,
    source: "meta_ads",
    source_ref: leadgenId,
    utm: { source: "meta", campaign: data.campaign_name ?? "", content: data.ad_name ?? "" },
  });
  return { http: result.http, ...result.body };
}
