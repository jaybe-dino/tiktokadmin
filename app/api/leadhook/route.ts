import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { processIngest } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 커넥터 전용 리드 인입 — 메타 개발자앱 없이 Zapier/Make/LeadsBridge 등으로 리드 유입.
//   메타 광고 리드 폼 제출 → 커넥터(Facebook Lead Ads 트리거) → 이 URL 로 POST.
//   설정 부담 최소화: 시크릿은 헤더(x-lead-secret) 또는 쿼리(?key=) 아무거나,
//   멱등키·필드명은 흔한 변형을 자동 인식. JSON / form 둘 다 허용.
//
//   URL 예: https://tiktokadmin.vercel.app/api/leadhook?key=<LEADHOOK_SECRET>
//   Body(JSON): { "email":"..","phone":"..","company":"..","name":"..","lead_id":".." }
//
//   필요 env: LEADHOOK_SECRET (미설정 시 INGEST_SECRET 로 폴백).

function secretOk(provided: string | null): boolean {
  const expected = env.leadhookSecret;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** JSON 또는 form-urlencoded 본문을 평평한 문자열 맵으로. */
async function readBody(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  const flat: Record<string, string> = {};
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      flat[k.toLowerCase()] = v == null ? "" : String(v);
    }
  } else {
    const raw = await req.text();
    const p = new URLSearchParams(raw);
    for (const [k, v] of p.entries()) flat[k.toLowerCase()] = v;
  }
  return flat;
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-lead-secret") ?? req.nextUrl.searchParams.get("key");
  if (!secretOk(key)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const f = await readBody(req);
  const pick = (...names: string[]) => names.map((n) => f[n]).find((v) => v && v.trim()) ?? "";

  const email = pick("email", "이메일", "work_email", "e-mail").toLowerCase();
  const phone = pick("phone", "phone_number", "전화번호", "연락처", "휴대폰번호", "mobile").replace(/[^0-9+]/g, "");
  const brandName = pick("company", "company_name", "회사명", "브랜드명", "brand", "brand_name");
  const contactName = pick("name", "full_name", "이름", "성함", "담당자명", "contact_name");
  const leadId = pick("lead_id", "leadgen_id", "id", "leadid");

  if (!email && !phone) {
    return NextResponse.json({ error: "validation", fields: ["email 또는 phone 최소 하나 필요"] }, { status: 400 });
  }

  // 멱등키: 리드ID > 이메일 > 전화 (같은 리드 재전송 시 중복 방지).
  const idemKey = `leadhook:${leadId || email || phone}`;

  const result = await processIngest("lead", idemKey, {
    site: "manual",
    email: email || null,
    phone: phone || null,
    brand_name: brandName || null,
    contact_name: contactName || null,
    source: "meta_ads",
    source_ref: leadId || null,
    utm: {
      source: pick("utm_source") || "meta",
      campaign: pick("campaign", "campaign_name", "utm_campaign"),
      content: pick("ad", "ad_name", "utm_content"),
    },
  });
  return NextResponse.json(result.body, { status: result.http });
}

// 커넥터가 URL 검증용으로 GET 을 보내는 경우(예: Make webhook ping) 200.
export function GET() {
  return NextResponse.json({ ok: true, hint: "POST 로 리드를 보내세요 (?key=<LEADHOOK_SECRET>)" });
}
