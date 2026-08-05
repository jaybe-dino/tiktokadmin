// 신규 리드 유입 → Slack #glovek-lead(leads 채널) 알림.
//   리드 상세 + 자동안내(문자·이메일) 발송여부를 함께 표시. 실패해도 유입 처리엔 영향 없음.
import { queryOne } from "./db";
import { env } from "./env";
import { slackPost, type Block } from "./slack";
import type { WelcomeResult } from "./intake-channels";

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
