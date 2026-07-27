import { query, queryOne } from "./db";
import { assignOwner, transitionBrand, type TransitionResult } from "./transition";
import { getBrand, touchLastContact } from "./repo/brands";
import { snoozeAlert } from "./repo/alerts";
import { draftReminder } from "./brief";
import { env } from "./env";
import type { OpsActor } from "./ops-auth";
import type { OwnerField, State } from "./types";

// ops 서비스 — 대시보드(서버액션)·Slack·MCP·HTTP 라우트가 공통 호출.
// 모든 함수는 감사 기록(stage_history/brand_sources/alerts)을 남긴다.

export async function opsTransition(
  a: OpsActor,
  input: { brand_id: string; to_state: State; reason?: string },
): Promise<TransitionResult> {
  return transitionBrand({
    brandId: input.brand_id,
    to: input.to_state,
    actor: a.actor,
    actorRole: a.role,
    reason: input.reason,
  });
}

export async function opsDrop(
  a: OpsActor,
  input: { brand_id: string; reason: string },
): Promise<TransitionResult> {
  if (!input.reason?.trim()) return { ok: false, needReason: true, error: "드랍 사유 필수" };
  return transitionBrand({
    brandId: input.brand_id,
    to: "dropped",
    actor: a.actor,
    actorRole: a.role,
    reason: input.reason,
  });
}

export async function opsAssign(
  a: OpsActor,
  input: { brand_id: string; role: OwnerField; admin_user_id: string },
): Promise<{ ok: boolean; error?: string }> {
  const res = await assignOwner(input.brand_id, input.role, input.admin_user_id);
  if (res.ok) {
    await query(
      `INSERT INTO stage_history (brand_id, from_state, to_state, actor, gate_passed, reason)
       SELECT id, state, state, $2, true, $3 FROM brands WHERE id=$1`,
      [input.brand_id, a.actor, `assign ${input.role}=${input.admin_user_id}`],
    );
  }
  return res;
}

export async function opsDocCheck(
  a: OpsActor,
  input: { brand_id: string; item_key: string; done: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const item = await queryOne<{ source: string }>(
    "SELECT source FROM doc_items WHERE brand_id=$1 AND item_key=$2",
    [input.brand_id, input.item_key],
  );
  if (!item) return { ok: false, error: "서류 항목 없음" };
  if (item.source === "apply_step") {
    return { ok: false, error: "apply 동기 항목은 수동 변경 불가 (apply 어드민에서 처리)" };
  }
  await query(
    `UPDATE doc_items
        SET done=$3, done_at = CASE WHEN $3 THEN now() ELSE NULL END, done_by=$4
      WHERE brand_id=$1 AND item_key=$2`,
    [input.brand_id, input.item_key, input.done, a.actor],
  );
  return { ok: true };
}

export async function opsLogContact(
  a: OpsActor,
  input: { brand_id: string; channel: "email" | "sms" | "call" | "meeting"; note?: string },
): Promise<{ ok: boolean }> {
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, source_ref, payload, occurred_at)
     VALUES ($1,'manual','contact_logged',$2,$3, now())
     ON CONFLICT (site, event, source_ref) DO NOTHING`,
    [
      input.brand_id,
      `contact:${input.brand_id}:${Date.now()}`,
      JSON.stringify({ channel: input.channel, note: input.note ?? "", actor: a.actor }),
    ],
  );
  await touchLastContact(input.brand_id);
  await query(
    "UPDATE alerts SET resolved_at=now(), resolved_by=$2 WHERE brand_id=$1 AND kind='stale' AND resolved_at IS NULL",
    [input.brand_id, a.actor],
  );
  return { ok: true };
}

export async function opsManualPayment(
  a: OpsActor,
  input: { brand_id: string; plan: string; amount: number; paid_at: string; next_due?: string; note?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (input.amount <= 0) return { ok: false, error: "금액 오류" };
  await query(
    `INSERT INTO payments_manual (brand_id, plan, amount, paid_at, next_due, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.brand_id, input.plan, input.amount, input.paid_at, input.next_due ?? null, input.note ?? "", a.actor],
  );
  return { ok: true };
}

export async function opsRemind(
  a: OpsActor,
  input: { brand_id: string; channel: "email" | "sms"; override_body?: string },
): Promise<{ ok: boolean; sent: boolean; draft: { subject?: string; body: string }; error?: string }> {
  const draft = await draftReminder(input.brand_id, input.channel);
  const body = input.override_body ?? draft.body;
  const brand = await getBrand(input.brand_id);
  if (!brand) return { ok: false, sent: false, draft, error: "브랜드 없음" };

  let sent = false;
  if (input.channel === "email" && env.resend.apiKey && brand.email) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.resend.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.resend.from,
          to: brand.email,
          subject: draft.subject ?? "[Glovek] 안내",
          text: body,
        }),
      });
      sent = r.ok;
    } catch (err) {
      console.warn("[remind] resend 실패:", (err as Error).message);
    }
  }

  await query(
    `INSERT INTO brand_sources (brand_id, site, event, source_ref, payload, occurred_at)
     VALUES ($1,'manual','remind',$2,$3, now())
     ON CONFLICT (site, event, source_ref) DO NOTHING`,
    [
      input.brand_id,
      `remind:${input.brand_id}:${Date.now()}`,
      JSON.stringify({ channel: input.channel, sent, actor: a.actor }),
    ],
  );
  return { ok: true, sent, draft: { subject: draft.subject, body } };
}

export async function opsSnooze(
  _a: OpsActor,
  input: { alert_id: string; until: string },
): Promise<{ ok: boolean }> {
  await snoozeAlert(input.alert_id, input.until);
  return { ok: true };
}
