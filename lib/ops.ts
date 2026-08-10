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
  input: { brand_id: string; to_state: State; reason?: string; force?: boolean },
): Promise<TransitionResult> {
  const res = await transitionBrand({
    brandId: input.brand_id,
    to: input.to_state,
    actor: a.actor,
    actorRole: a.role,
    reason: input.reason,
    force: input.force,
  });
  // 해지 전이 성공 시 오프보딩 5연쇄 (17 §1)
  if (res.ok && input.to_state === "churned") {
    const { runChurnChain } = await import("./lifecycle");
    await runChurnChain(input.brand_id, input.reason ?? "미기재", a.actor).catch((e) =>
      console.error("[churn-chain]", (e as Error).message));
  }
  return res;
}

export async function opsDrop(
  a: OpsActor,
  input: { brand_id: string; reason: string },
): Promise<TransitionResult> {
  if (!input.reason?.trim()) return { ok: false, needReason: true, error: "드랍 사유 필수" };

  // #2 드랍 결재선: 결재권한(lead|exec) 미보유자는 즉시 드랍 대신 결재 요청을 생성한다.
  //  승인권자(app/api/ops/approve)가 승인해야 실제 dropped 전이가 일어난다.
  if (a.role !== "lead" && a.role !== "exec") {
    try {
      await query(
        `INSERT INTO approval_requests (brand_id, kind, payload, requested_by, status)
         VALUES ($1, 'drop', $2, $3, 'pending')`,
        [input.brand_id, JSON.stringify({ reason: input.reason }), a.actor],
      );
    } catch (e) {
      console.error("[ops-drop] 결재 요청 생성 실패:", (e as Error).message);
      return { ok: false, error: "결재 요청 생성 실패" };
    }
    return { ok: true, pending: true };
  }

  // 승인권자는 기존대로 즉시 드랍.
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
  if (input.channel === "email" && brand.email) {
    // 공용 mailer 경유 — Gmail 위임(기본 발신 메일함) 우선, 실패 시 Resend 폴백. (sales#5)
    try {
      const { sendEmail } = await import("./mailer");
      const r = await sendEmail({
        to: brand.email,
        subject: draft.subject ?? "[Glovek] 안내",
        text: body,
      });
      sent = r.ok;
      if (!r.ok) console.warn("[remind] 메일 발송 실패:", r.error ?? (r.skipped ? "발송 미설정" : "unknown"));
    } catch (err) {
      console.warn("[remind] 메일 발송 예외:", (err as Error).message);
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

export async function opsStageCheck(
  a: OpsActor,
  input: { brand_id: string; req_id: string; done: boolean },
): Promise<{ ok: boolean }> {
  const { setStageCheck } = await import("./requirements");
  await setStageCheck(input.brand_id, input.req_id, input.done, a.actor);
  return { ok: true };
}
