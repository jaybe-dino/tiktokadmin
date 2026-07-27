import { env } from "./env";
import { GRADES, PLAN_LABELS, STATE_LABELS, type Brand } from "./types";
import type { Block } from "./slack";

// Block Kit 카드 빌더 (05-SLACK-APP §3).
// action_id 에 의도, value 에 {brand_id, alert_id?} JSON.

function val(brandId: string, alertId?: string): string {
  return JSON.stringify({ brand_id: brandId, alert_id: alertId });
}

function gradeBadge(grade: string | null): string {
  if (!grade || !GRADES.includes(grade as never)) return "·";
  return grade;
}

export function brandAlertCard(
  brand: Pick<Brand, "id" | "brand_name" | "state" | "grade" | "plan">,
  opts: { headline: string; ownerMention?: string; alertId?: string; note?: string } = { headline: "" },
): Block[] {
  const owner = opts.ownerMention ? ` · 담당 ${opts.ownerMention}` : "";
  const note = opts.note ? `\n${opts.note}` : "";
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔴 *[${brand.brand_name}]* ${opts.headline}${owner}\n등급 ${gradeBadge(brand.grade)} · ${STATE_LABELS[brand.state]}${brand.plan ? ` · ${PLAN_LABELS[brand.plan]}` : ""}${note}`,
      },
    },
    {
      type: "actions",
      elements: [
        { type: "button", action_id: "transition", text: { type: "plain_text", text: "이동 승인 ▸" }, style: "primary", value: val(brand.id, opts.alertId) },
        { type: "button", action_id: "assign", text: { type: "plain_text", text: "담당 변경" }, value: val(brand.id, opts.alertId) },
        { type: "button", action_id: "remind", text: { type: "plain_text", text: "리마인더 발송" }, value: val(brand.id, opts.alertId) },
        { type: "button", action_id: "doc_check", text: { type: "plain_text", text: "서류 수령 ✓" }, value: val(brand.id, opts.alertId) },
        { type: "button", action_id: "snooze", text: { type: "plain_text", text: "1일 스누즈" }, value: val(brand.id, opts.alertId) },
        { type: "button", action_id: "drop", text: { type: "plain_text", text: "드랍" }, style: "danger", value: val(brand.id, opts.alertId) },
        { type: "button", action_id: "open360", text: { type: "plain_text", text: "360 ↗" }, url: `${env.adminUrl}/brand/${brand.id}` },
      ],
    },
  ];
}

/** 처리 완료 후 카드 갱신 (chat.update) */
export function resolvedCard(brandName: string, action: string, byUser: string): Block[] {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `✅ *[${brandName}]* ${action} 처리됨 · by <@${byUser}>` },
    },
  ];
}

/** /brand 360 요약 카드 */
export function brand360Card(
  brand: Brand,
  extra: { docDone: number; docTotal: number; churn: string },
): Block[] {
  const owners = [brand.owner_intake, brand.owner_sales, brand.owner_onboard, brand.owner_ads]
    .filter(Boolean)
    .join(", ") || "미지정";
  return [
    { type: "section", text: { type: "mrkdwn", text: `*[${brand.brand_name}]* · ${STATE_LABELS[brand.state]} · 등급 ${gradeBadge(brand.grade)}` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*플랜*\n${brand.plan ? PLAN_LABELS[brand.plan] : "미정"}` },
        { type: "mrkdwn", text: `*결제*\n${brand.pay_status}` },
        { type: "mrkdwn", text: `*서류*\n${extra.docDone}/${extra.docTotal}` },
        { type: "mrkdwn", text: `*이탈위험*\n${extra.churn}` },
        { type: "mrkdwn", text: `*담당*\n${owners}` },
        { type: "mrkdwn", text: `*다음 액션*\n${brand.next_action || "—"}` },
      ],
    },
    {
      type: "actions",
      elements: [
        { type: "button", action_id: "transition", text: { type: "plain_text", text: "이동 ▸" }, style: "primary", value: val(brand.id) },
        { type: "button", action_id: "remind", text: { type: "plain_text", text: "리마인더" }, value: val(brand.id) },
        { type: "button", action_id: "open360", text: { type: "plain_text", text: "360 ↗" }, url: `${env.adminUrl}/brand/${brand.id}` },
      ],
    },
  ];
}

export function sectionText(text: string): Block {
  return { type: "section", text: { type: "mrkdwn", text } };
}

export function divider(): Block {
  return { type: "divider" };
}
