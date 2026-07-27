import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, slackOpenView, slackEphemeral } from "@/lib/slack";
import { resolveSlackActor } from "@/lib/slack-actor";
import { getBrand } from "@/lib/repo/brands";
import { docProgress } from "@/lib/docs";
import { draftReminder } from "@/lib/brief";
import { adminUserList } from "@/lib/repo/queries";
import { opsDrop, opsDocCheck, opsRemind, opsSnooze, opsTransition } from "@/lib/ops";
import {
  assignModal, docCheckModal, dropModal, parseMeta, remindModal, transitionModal,
} from "@/lib/slack-views";
import { opsAssign } from "@/lib/ops";
import type { OwnerField, State } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!verifySlackSignature(raw, ts, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const params = new URLSearchParams(raw);
  const payload = JSON.parse(params.get("payload") ?? "{}");

  if (payload.type === "block_actions") {
    // 3초 내 ack. 모달 오픈은 trigger_id 로.
    await handleBlockAction(payload).catch((e) => console.error("[slack] action", e));
    return NextResponse.json({});
  }

  if (payload.type === "view_submission") {
    return handleViewSubmission(payload);
  }

  return NextResponse.json({});
}

async function handleBlockAction(payload: Record<string, unknown>): Promise<void> {
  const action = (payload.actions as { action_id: string; value?: string }[])?.[0];
  if (!action) return;
  const triggerId = payload.trigger_id as string;
  const user = (payload.user as { id: string }).id;
  const channel = (payload.channel as { id?: string } | undefined)?.id;
  const { brand_id, alert_id } = JSON.parse(action.value ?? "{}");

  const actor = await resolveSlackActor(user);
  if (!actor) {
    if (channel) await slackEphemeral(channel, user, { text: "권한이 없습니다. admin_users 에 Slack ID 매핑이 필요합니다." });
    return;
  }

  const brand = await getBrand(brand_id);
  if (!brand) return;

  switch (action.action_id) {
    case "transition":
      await slackOpenView(triggerId, transitionModal(brand, alert_id));
      break;
    case "assign": {
      const users = await adminUserList();
      await slackOpenView(triggerId, assignModal(brand, users, alert_id));
      break;
    }
    case "remind": {
      const draft = await draftReminder(brand_id, "email");
      await slackOpenView(triggerId, remindModal(brand, draft.body, alert_id));
      break;
    }
    case "doc_check": {
      const prog = await docProgress(brand_id);
      await slackOpenView(triggerId, docCheckModal(brand, prog.items, alert_id));
      break;
    }
    case "drop":
      await slackOpenView(triggerId, dropModal(brand, alert_id));
      break;
    case "snooze":
      if (alert_id) await opsSnooze(actor, { alert_id, until: new Date(Date.now() + 86_400_000).toISOString() });
      if (channel) await slackEphemeral(channel, user, { text: `${brand.brand_name} 알림 1일 스누즈` });
      break;
  }
}

async function handleViewSubmission(payload: Record<string, unknown>): Promise<NextResponse> {
  const view = payload.view as {
    callback_id: string;
    private_metadata: string;
    state: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string }; selected_options?: { value: string }[] }>> };
  };
  const user = (payload.user as { id: string }).id;
  const actor = await resolveSlackActor(user);
  if (!actor) {
    return NextResponse.json({ response_action: "errors", errors: { to_state: "권한 없음" } });
  }
  const { brand_id } = parseMeta(view.private_metadata);
  const v = view.state.values;

  switch (view.callback_id) {
    case "submit_transition": {
      const to = v.to_state?.v?.selected_option?.value as State;
      const reason = v.reason?.v?.value;
      const res = await opsTransition(actor, { brand_id, to_state: to, reason });
      if (!res.ok) {
        const label = res.failed?.map((f) => f.label).join(" · ") || res.error || "이동 불가";
        return NextResponse.json({ response_action: "errors", errors: { to_state: `이동 불가: ${label}` } });
      }
      return NextResponse.json({ response_action: "clear" });
    }
    case "submit_assign": {
      const role = v.role?.v?.selected_option?.value as OwnerField;
      const uid = v.user?.v?.selected_option?.value ?? "";
      await opsAssign(actor, { brand_id, role, admin_user_id: uid });
      return NextResponse.json({ response_action: "clear" });
    }
    case "submit_remind": {
      const body = v.body?.v?.value ?? "";
      await opsRemind(actor, { brand_id, channel: "email", override_body: body });
      return NextResponse.json({ response_action: "clear" });
    }
    case "submit_doc_check": {
      const selected = v.items?.v?.selected_options ?? [];
      for (const o of selected) await opsDocCheck(actor, { brand_id, item_key: o.value, done: true });
      return NextResponse.json({ response_action: "clear" });
    }
    case "submit_drop": {
      const reason = v.reason?.v?.value ?? "";
      const res = await opsDrop(actor, { brand_id, reason });
      if (!res.ok) return NextResponse.json({ response_action: "errors", errors: { reason: res.error ?? "사유 필요" } });
      return NextResponse.json({ response_action: "clear" });
    }
    default:
      return NextResponse.json({});
  }
}
