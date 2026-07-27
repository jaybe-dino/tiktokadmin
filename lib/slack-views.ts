import { FORWARD_TRANSITIONS } from "./states";
import { STATE_LABELS, type Brand, type State } from "./types";

// Slack 모달 뷰 빌더 (05-SLACK-APP §4).
// private_metadata 에 {brand_id, alert_id?} JSON.

function meta(brandId: string, alertId?: string): string {
  return JSON.stringify({ brand_id: brandId, alert_id: alertId });
}

export function transitionModal(brand: Brand, alertId?: string): Record<string, unknown> {
  const nexts = [...(FORWARD_TRANSITIONS[brand.state] ?? []), "dropped" as State];
  return {
    type: "modal",
    callback_id: "submit_transition",
    private_metadata: meta(brand.id, alertId),
    title: { type: "plain_text", text: "상태 이동" },
    submit: { type: "plain_text", text: "이동" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${brand.brand_name}* · 현재 ${STATE_LABELS[brand.state]}` } },
      {
        type: "input",
        block_id: "to_state",
        label: { type: "plain_text", text: "이동할 상태" },
        element: {
          type: "static_select",
          action_id: "v",
          options: nexts.map((s) => ({
            text: { type: "plain_text", text: STATE_LABELS[s as State] },
            value: s,
          })),
        },
      },
      {
        type: "input",
        block_id: "reason",
        optional: true,
        label: { type: "plain_text", text: "사유 (드랍/후퇴 시 필수)" },
        element: { type: "plain_text_input", action_id: "v" },
      },
    ],
  };
}

export function assignModal(
  brand: Brand,
  users: { id: string; name: string; role: string }[],
  alertId?: string,
): Record<string, unknown> {
  const roleOpts = [
    { text: { type: "plain_text", text: "유입" }, value: "owner_intake" },
    { text: { type: "plain_text", text: "영업" }, value: "owner_sales" },
    { text: { type: "plain_text", text: "온보딩" }, value: "owner_onboard" },
    { text: { type: "plain_text", text: "광고" }, value: "owner_ads" },
  ];
  return {
    type: "modal",
    callback_id: "submit_assign",
    private_metadata: meta(brand.id, alertId),
    title: { type: "plain_text", text: "담당 변경" },
    submit: { type: "plain_text", text: "저장" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      {
        type: "input",
        block_id: "role",
        label: { type: "plain_text", text: "역할" },
        element: { type: "static_select", action_id: "v", options: roleOpts },
      },
      {
        type: "input",
        block_id: "user",
        label: { type: "plain_text", text: "담당자" },
        element: {
          type: "static_select",
          action_id: "v",
          options: users.map((u) => ({
            text: { type: "plain_text", text: `${u.name} (${u.role})` },
            value: u.id,
          })),
        },
      },
    ],
  };
}

export function remindModal(brand: Brand, draftBody: string, alertId?: string): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: "submit_remind",
    private_metadata: meta(brand.id, alertId),
    title: { type: "plain_text", text: "리마인더 발송" },
    submit: { type: "plain_text", text: "발송" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${brand.brand_name}* 에게 이메일 발송` } },
      {
        type: "input",
        block_id: "body",
        label: { type: "plain_text", text: "내용 (수정 가능)" },
        element: { type: "plain_text_input", action_id: "v", multiline: true, initial_value: draftBody },
      },
    ],
  };
}

export function docCheckModal(
  brand: Brand,
  items: { item_key: string; label: string; done: boolean; source: string }[],
  alertId?: string,
): Record<string, unknown> {
  const pending = items.filter((i) => !i.done && i.source !== "apply_step");
  const options = pending.map((i) => ({
    text: { type: "plain_text", text: i.label },
    value: i.item_key,
  }));
  return {
    type: "modal",
    callback_id: "submit_doc_check",
    private_metadata: meta(brand.id, alertId),
    title: { type: "plain_text", text: "서류 수령" },
    submit: { type: "plain_text", text: "체크" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      options.length
        ? {
            type: "input",
            block_id: "items",
            optional: true,
            label: { type: "plain_text", text: "수령한 서류 (apply 동기 항목 제외)" },
            element: { type: "checkboxes", action_id: "v", options },
          }
        : { type: "section", text: { type: "mrkdwn", text: "체크 가능한 미완 항목이 없습니다." } },
    ],
  };
}

export function dropModal(brand: Brand, alertId?: string): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: "submit_drop",
    private_metadata: meta(brand.id, alertId),
    title: { type: "plain_text", text: "드랍" },
    submit: { type: "plain_text", text: "드랍" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      {
        type: "input",
        block_id: "reason",
        label: { type: "plain_text", text: "드랍 사유 (필수)" },
        element: { type: "plain_text_input", action_id: "v" },
      },
    ],
  };
}

export function parseMeta(privateMetadata: string): { brand_id: string; alert_id?: string } {
  try {
    return JSON.parse(privateMetadata);
  } catch {
    return { brand_id: "" };
  }
}
