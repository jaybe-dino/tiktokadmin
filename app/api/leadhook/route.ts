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

// 키 정규화 — 대소문자·공백·언더스코어·하이픈 무시 (예: "Phone Number"="phone_number"="phonenumber").
//   커넥터(메타/Zapier)가 라벨형 키(공백 포함)로 보내도 매핑되도록.
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, "");

/** JSON 또는 form-urlencoded 본문을 정규화 키 맵으로. 중첩 객체는 값만 평탄화. */
async function readBody(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  const flat: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v == null) return;
    if (typeof v === "object") { for (const [k2, v2] of Object.entries(v)) put(`${k}_${k2}`, v2); return; }
    flat[norm(k)] = String(v);
  };
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) put(k, v);
  } else {
    const raw = await req.text();
    for (const [k, v] of new URLSearchParams(raw).entries()) flat[norm(k)] = v;
  }
  return flat;
}

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // 2-키 인증: key=전역 Vercel 시크릿(마스터 게이트) + source=소스 id 키(어느 유입 루트).
  const key = req.headers.get("x-lead-secret") ?? sp.get("key");

  const f = await readBody(req);
  // URL 쿼리스트링도 필드로 병합(본문 우선). 인증 파라미터는 리드 필드에서 제외.
  const AUTH_PARAMS = new Set(["key", "source", "sid", "channel"]);
  for (const [k, v] of sp.entries()) {
    const nk = norm(k);
    if (!AUTH_PARAMS.has(nk) && v && !f[nk]) f[nk] = v;
  }

  // 소스 id(채널) — 헤더 > URL쿼리 > 본문 Data 순. (커넥터가 Data 에 source 를 넣어도 인식)
  const sourceId = req.headers.get("x-lead-source") ?? sp.get("source") ?? sp.get("sid") ?? sp.get("channel")
    ?? f.source ?? f.sid ?? f.channel;
  const { resolveChannel } = await import("@/lib/intake-channels");
  let channel = sourceId ? await resolveChannel(sourceId) : null;
  const globalOk = secretOk(key);
  if (!channel && !globalOk && key) channel = await resolveChannel(key);  // 하위호환(key=채널키)

  // 인가: 전역 시크릿이 맞거나(권장) 유효한 채널키면 통과.
  if (!globalOk && !channel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 정규화 키로 조회 — 인자도 norm 적용해 형식 무관 매칭.
  const pick = (...names: string[]) => names.map((n) => f[norm(n)]).find((v) => v && v.trim()) ?? "";

  const email = pick("email", "이메일", "work_email", "e-mail", "email_address", "이메일주소").toLowerCase();
  const phone = pick("phone", "phone_number", "전화번호", "연락처", "휴대폰번호", "휴대폰", "mobile", "mobile_number", "tel").replace(/[^0-9+]/g, "");
  const brandName = pick("company", "company_name", "회사명", "브랜드명", "brand", "brand_name", "회사");
  const contactName = pick("name", "full_name", "fullname", "이름", "성함", "담당자명", "contact_name", "first_name") || pick("last_name");
  const leadId = pick("lead_id", "leadgen_id", "id", "leadid", "leadgenid");
  const website = pick("website", "url", "웹사이트", "홈페이지", "site_url", "homepage");
  const category = pick("category", "categori", "카테고리", "브랜드 주력 카테고리", "brand_category");

  if (!email && !phone) {
    // 진단 — 어떤 키로 왔는지 반환(값 아님, 키 이름만)해서 매핑을 정확히 맞춘다.
    return NextResponse.json(
      { error: "validation", fields: ["email 또는 phone 최소 하나 필요"], received_keys: Object.keys(f) },
      { status: 400 });
  }

  // 멱등키: 채널 접두 + 리드ID > 이메일 > 전화 (같은 리드 재전송 시 중복 방지).
  const prefix = channel ? `ch:${channel.id}` : "leadhook";
  const idemKey = `${prefix}:${leadId || email || phone}`;

  // 커넥터가 생성시각을 주면 우선 사용, 없으면 수신시각. (occurred_at 은 Common 필수)
  const occurredAt = pick("created_time", "created_at", "timestamp", "occurred_at") || new Date().toISOString();

  // 소스 라벨 — 채널이 지정한 source(주제별) 우선, 없으면 meta_ads.
  const source = channel?.source || "meta_ads";

  const result = await processIngest("lead", idemKey, {
    site: "manual",
    occurred_at: occurredAt,
    email: email || null,
    phone: phone || null,
    brand_name: brandName || null,
    contact_name: contactName || null,
    brand_url: website || null,
    category: category || null,
    source,
    source_ref: leadId || null,
    utm: {
      source: pick("utm_source") || (channel ? "channel" : "meta"),
      campaign: pick("campaign", "campaign_name", "utm_campaign") || (channel?.name ?? ""),
      content: pick("ad", "ad_name", "utm_content"),
    },
  }, { skipLeadNotify: true });  // 아래에서 채널 상세 포함 알림 직접 발송

  // 채널 매칭 시: 통계 갱신 + 채널별 문자·메일 자동발송(토글·템플릿). 신규 리드에만.
  //   + Slack #glovek-lead 알림(리드 상세 + 자동발송 여부). 유입 처리엔 영향 없음(best-effort).
  if (result.http === 200) {
    const brandId = (result.body as { brand_id?: string }).brand_id;
    const created = (result.body as { created?: boolean }).created;
    if (brandId) {
      const { notifyNewLead } = await import("@/lib/lead-notify");
      let welcome: import("@/lib/intake-channels").WelcomeResult | null = null;
      if (channel) {
        const { recordChannelLead, sendChannelWelcome } = await import("@/lib/intake-channels");
        await recordChannelLead(channel.id).catch(() => {});
        if (created) welcome = await sendChannelWelcome(brandId, channel).catch(() => null);
      }
      await notifyNewLead(brandId, {
        channelName: channel?.name ?? null,
        created,
        welcome,
        autoSendReason: channel ? undefined : "자동발송 대상 아님(소스 미매칭 유입)",
      }).catch(() => {});
    }
  }

  return NextResponse.json(result.body, { status: result.http });
}

// 커넥터가 URL 검증용으로 GET 을 보내는 경우(예: Make webhook ping) 200.
export function GET() {
  return NextResponse.json({ ok: true, hint: "POST 로 리드를 보내세요 (?key=<LEADHOOK_SECRET>)" });
}
