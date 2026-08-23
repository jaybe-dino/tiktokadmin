// 신규 리드 유입 → Slack #glovek-lead(leads 채널) 알림.
//   리드 상세 + 자동안내(문자·이메일) 발송여부를 함께 표시. 실패해도 유입 처리엔 영향 없음.
import { queryOne } from "./db";
import { env } from "./env";
import { slackPost, type Block } from "./slack";
import { STATE_LABELS, type Brand } from "./types";
import type { WelcomeResult } from "./intake-channels";

// 단계 → (Slack 채널, 책임 담당 필드 우선순위). intake 단계 위반은 intake 채널로.
const STAGE_ROUTE: Record<string, { channel: string; owners: string[] }> = {
  lead_new: { channel: "intake", owners: ["owner_intake", "owner_sales"] },
  seminar: { channel: "intake", owners: ["owner_sales", "owner_intake"] },
  meeting: { channel: "intake", owners: ["owner_sales", "owner_intake"] },
  contact: { channel: "intake", owners: ["owner_sales", "owner_intake"] },
  contract_review: { channel: "intake", owners: ["owner_contract", "owner_sales"] },
  contract_done: { channel: "onboard", owners: ["owner_onboard", "owner_contract"] },
  docs: { channel: "onboard", owners: ["owner_onboard"] },
  setup: { channel: "onboard", owners: ["owner_onboard"] },
  live_onboarding: { channel: "onboard", owners: ["owner_onboard", "owner_ads"] },
  live_mall: { channel: "ads", owners: ["owner_ads"] },
  settling: { channel: "pay", owners: ["owner_contract", "owner_sales"] },
};

/** SLA 초과 → 담당자 @태그 후 단계별 채널에 알림. 담당의 slack_user_id 로 멘션. */
export async function notifySlaBreach(
  brand: Brand,
  breach: { elapsed: number; maxDays: number; daysOver: number; tier: number },
): Promise<string | null> {
  const route = STAGE_ROUTE[brand.state] ?? { channel: "intake", owners: ["owner_sales", "owner_intake"] };
  // 책임 담당 id(admin_users.id=이메일) 결정 — 우선순위대로 첫 지정 담당.
  let ownerId: string | null = null;
  for (const f of route.owners) { const v = (brand as unknown as Record<string, unknown>)[f]; if (v) { ownerId = String(v); break; } }
  // slack_user_id 조회 → 멘션 문자열.
  let mention = "⚠️ *담당 미배정*";
  if (ownerId) {
    const u = await queryOne<{ name: string; slack_user_id: string | null }>(
      "SELECT name, slack_user_id FROM admin_users WHERE id=$1", [ownerId]).catch(() => null);
    if (u?.slack_user_id) mention = `담당 <@${u.slack_user_id}>`;
    else if (u?.name) mention = `담당 ${u.name} _(Slack 미연동)_`;
    else mention = `담당 ${ownerId}`;
  }
  const link = env.adminUrl ? `${env.adminUrl}/brand/${brand.id}` : `/brand/${brand.id}`;
  const stageLabel = STATE_LABELS[brand.state] ?? brand.state;
  const tierTag = breach.tier >= 3 ? " 🔴 심각" : breach.tier >= 2 ? " 🟠" : "";
  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: `⏰ SLA 초과${tierTag} — ${brand.brand_name}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: `*${stageLabel}* 단계 ${breach.elapsed}영업일 경과 (SLA ${breach.maxDays}일 · +${breach.daysOver}일 초과)\n${mention}` } },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "브랜드 카드 열기", emoji: true }, url: link, style: "primary" }] },
  ];
  const summary = `⏰ SLA 초과: ${brand.brand_name} · ${stageLabel} +${breach.daysOver}일`;
  const r = await slackPost({ channelKey: route.channel, text: summary, blocks }).catch(() => ({ ok: false } as { ok: boolean; ts?: string }));
  return r.ok && r.ts ? r.ts : null;
}

interface LeadBrandRow {
  brand_name: string; contact_name: string | null;
  email: string | null; phone: string | null;
  category: string | null; brand_url: string | null; source: string | null;
}

export interface NotifyLeadOpts {
  channelName?: string | null;   // 유입 소스(채널) 이름
  created?: boolean;             // 신규 생성(true) vs 기존 병합(false)
  welcome?: WelcomeResult | null; // 자동발송 결과(채널 매칭 시)
  autoSendReason?: string;       // 자동발송 미실행 사유(채널 미매칭 등)
}

// 자동발송 상태 한 줄 요약.
function autoSendLines(w: NotifyLeadOpts["welcome"], reason?: string): string {
  if (!w) return `⚙️ 자동안내: ${reason || "대상 아님(소스 미매칭)"}`;
  if (w.disabled) return "⚙️ 자동안내: 소스에서 자동발송 미허용";
  if (w.alreadySent) return "⚙️ 자동안내: 이미 발송됨(중복 방지)";
  const parts: string[] = [];
  if (w.smsAttempted) parts.push(w.sent.includes("sms") ? `문자 ✅${w.testMode ? "(테스트)" : ""}` : `문자 ❌${w.smsErr ? ` (${w.smsErr})` : ""}`);
  else parts.push("문자 —(대상/토글 없음)");
  if (w.emailAttempted) parts.push(w.sent.includes("email") ? `이메일 ✅${w.testMode ? "(테스트)" : ""}` : `이메일 ❌${w.emailErr ? ` (${w.emailErr})` : ""}`);
  else parts.push("이메일 —(대상/토글 없음)");
  return `⚙️ 자동안내: ${parts.join(" · ")}`;
}

/** 신규 리드 유입 알림 발송. brandId 로 상세를 조회해 leads 채널에 포스트. */
export async function notifyNewLead(brandId: string, opts: NotifyLeadOpts = {}): Promise<void> {
  const b = await queryOne<LeadBrandRow>(
    `SELECT brand_name, contact_name, email, phone, category, brand_url, source
       FROM brands WHERE id=$1`, [brandId]).catch(() => null);
  if (!b) return;

  const link = env.adminUrl ? `${env.adminUrl}/brand/${brandId}` : `/brand/${brandId}`;
  const detail: string[] = [];
  if (b.contact_name) detail.push(`👤 ${b.contact_name}`);
  if (b.phone) detail.push(`📞 ${b.phone}`);
  if (b.email) detail.push(`✉️ ${b.email}`);
  if (b.category) detail.push(`🏷️ ${b.category}`);
  if (b.brand_url) detail.push(`🔗 ${b.brand_url}`);

  const srcBits = [opts.channelName, b.source].filter(Boolean).join(" · ") || "직접 유입";
  const headline = opts.created === false ? "♻️ 리드 갱신(기존 브랜드)" : "🆕 신규 리드 유입";

  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: `${headline} — ${b.brand_name}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: detail.length ? detail.join("\n") : "_상세 연락처 없음_" } },
    { type: "context", elements: [{ type: "mrkdwn", text: `📥 소스: ${srcBits}` }] },
    { type: "section", text: { type: "mrkdwn", text: autoSendLines(opts.welcome, opts.autoSendReason) } },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "브랜드 카드 열기", emoji: true }, url: link, style: "primary" }] },
  ];

  const summary = `${headline}: ${b.brand_name}${b.contact_name ? ` (${b.contact_name})` : ""}`;
  await slackPost({ channelKey: "leads", text: summary, blocks }).catch(() => {});
}
