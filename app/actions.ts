"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import type { OpsActor } from "@/lib/ops-auth";
import type { ImportRecord } from "@/lib/import";
import {
  opsAssign, opsDocCheck, opsDrop, opsLogContact, opsManualPayment,
  opsRemind, opsSnooze, opsTransition,
} from "@/lib/ops";
import type { OwnerField, State } from "@/lib/types";

async function actor(): Promise<OpsActor | null> {
  const u = await currentUser();
  if (!u) return null;
  return { actor: `admin:${u.id}`, role: u.role };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  failed?: { rule: string; label: string }[];
}

export async function transitionAction(brandId: string, to: State, reason?: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const res = await opsTransition(a, { brand_id: brandId, to_state: to, reason });
  revalidatePath("/");
  revalidatePath(`/brand/${brandId}`);
  return { ok: res.ok, error: res.error, failed: res.failed };
}

export async function dropAction(brandId: string, reason: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const res = await opsDrop(a, { brand_id: brandId, reason });
  revalidatePath("/");
  revalidatePath(`/brand/${brandId}`);
  return { ok: res.ok, error: res.error };
}

export async function assignAction(brandId: string, role: OwnerField, adminUserId: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const res = await opsAssign(a, { brand_id: brandId, role, admin_user_id: adminUserId });
  revalidatePath(`/brand/${brandId}`);
  return res;
}

export async function docCheckAction(brandId: string, itemKey: string, done: boolean): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const res = await opsDocCheck(a, { brand_id: brandId, item_key: itemKey, done });
  revalidatePath(`/brand/${brandId}`);
  return res;
}

export async function logContactAction(
  brandId: string,
  channel: "email" | "sms" | "call" | "meeting",
  note?: string,
): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await opsLogContact(a, { brand_id: brandId, channel, note });
  revalidatePath(`/brand/${brandId}`);
  revalidatePath("/queue");
  return { ok: true };
}

export async function manualPaymentAction(input: {
  brandId: string; plan: string; amount: number; paid_at: string; next_due?: string; note?: string;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const res = await opsManualPayment(a, {
    brand_id: input.brandId, plan: input.plan, amount: input.amount,
    paid_at: input.paid_at, next_due: input.next_due, note: input.note,
  });
  revalidatePath(`/brand/${input.brandId}`);
  revalidatePath("/pay");
  return res;
}

export async function remindAction(brandId: string, channel: "email" | "sms", overrideBody?: string): Promise<ActionResult & { draft?: { subject?: string; body: string }; sent?: boolean }> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const res = await opsRemind(a, { brand_id: brandId, channel, override_body: overrideBody });
  revalidatePath(`/brand/${brandId}`);
  return { ok: res.ok, error: res.error, draft: res.draft, sent: res.sent };
}

export async function snoozeAction(alertId: string, until?: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await opsSnooze(a, { alert_id: alertId, until: until ?? new Date(Date.now() + 86_400_000).toISOString() });
  revalidatePath("/monitor");
  return { ok: true };
}

export async function setNextActionAction(brandId: string, nextAction: string, dueDate?: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { query } = await import("@/lib/db");
  await query("UPDATE brands SET next_action=$2, due_date=$3 WHERE id=$1", [
    brandId, nextAction, dueDate || null,
  ]);
  revalidatePath("/queue");
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

// ── 데이터 직접 입력 (수동 추가 · CSV 가져오기) ──────────────
// 기존 데이터를 현재 단계·등급·플랜·결제·담당까지 그대로 반영(게이트 우회 로드).

export async function createBrandAction(
  input: ImportRecord,
): Promise<ActionResult & { brand_id?: string }> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { importBrandRecord } = await import("@/lib/import");
  const res = await importBrandRecord(a.actor, input);
  if (res.ok) {
    revalidatePath("/");
    return { ok: true, brand_id: res.brand_id };
  }
  return { ok: false, error: res.error };
}

export async function importBrandsAction(
  csvText: string,
): Promise<{ ok: boolean; created: number; updated: number; skipped: number; errors: string[] }> {
  const a = await actor();
  if (!a) return { ok: false, created: 0, updated: 0, skipped: 0, errors: ["세션 만료"] };
  const { parseCsv } = await import("@/lib/csv");
  const { importBrandRecord } = await import("@/lib/import");
  const rows = parseCsv(csvText);
  let created = 0, updated = 0, skipped = 0;
  const errors: string[] = [];

  const g = (r: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) if (r[k]) return r[k];
    return undefined;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rec: ImportRecord = {
      brand_name: g(r, "brand_name", "brand", "brandname", "브랜드", "브랜드명"),
      email: r.email,
      phone: r.phone,
      biz_no: g(r, "biz_no", "bizno", "사업자번호"),
      contact_name: g(r, "contact_name", "contact", "담당자"),
      category: g(r, "category", "카테고리"),
      brand_url: g(r, "brand_url", "url"),
      source: r.source,
      state: r.state,
      grade: r.grade,
      plan: r.plan,
      contract_type: g(r, "contract_type", "계약형태"),
      pay_status: g(r, "pay_status", "결제상태"),
      rec_track: r.rec_track,
      owner_intake: r.owner_intake,
      owner_sales: r.owner_sales,
      owner_onboard: r.owner_onboard,
      owner_ads: r.owner_ads,
      next_action: g(r, "next_action", "다음액션"),
      due_date: r.due_date,
      memo: g(r, "memo", "메모"),
      countries: r.countries,
    };
    const res = await importBrandRecord(a.actor, rec);
    if (res.ok) {
      if (res.created) created++;
      else updated++;
    } else {
      skipped++;
      if (errors.length < 10) errors.push(`행 ${i + 2}: ${res.error}`);
    }
  }
  revalidatePath("/");
  return { ok: true, created, updated, skipped, errors };
}

async function requireLead(): Promise<OpsActor | null> {
  const u = await currentUser();
  if (!u || (u.role !== "lead" && u.role !== "exec")) return null;
  return { actor: `admin:${u.id}`, role: u.role };
}

export async function updateSlaPolicyAction(state: string, maxDays: number): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const { query } = await import("@/lib/db");
  await query("UPDATE sla_policies SET max_days=$2 WHERE state=$1", [state, maxDays]);
  revalidatePath("/settings");
  return { ok: true };
}

export async function stageCheckAction(brandId: string, reqId: string, done: boolean): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { opsStageCheck } = await import("@/lib/ops");
  await opsStageCheck(a, { brand_id: brandId, req_id: reqId, done });
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function addRequirementAction(input: {
  state: string; kind: "check" | "field"; field_key?: string; label: string;
}): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const { addRequirement } = await import("@/lib/requirements");
  await addRequirement({ state: input.state, kind: input.kind, field_key: input.field_key, label: input.label });
  revalidatePath("/settings");
  return { ok: true };
}

export async function toggleRequirementAction(id: string, active: boolean): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음" };
  const { setRequirementActive } = await import("@/lib/requirements");
  await setRequirementActive(id, active);
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteRequirementAction(id: string): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음" };
  const { deleteRequirement } = await import("@/lib/requirements");
  await deleteRequirement(id);
  revalidatePath("/settings");
  return { ok: true };
}

export async function upsertAdminUserAction(input: {
  id: string; name: string; role: string; slack_user_id?: string;
}): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const { query } = await import("@/lib/db");
  await query(
    `INSERT INTO admin_users (id, name, role, slack_user_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, slack_user_id=EXCLUDED.slack_user_id`,
    [input.id.toLowerCase(), input.name, input.role, input.slack_user_id || null],
  );
  revalidatePath("/settings");
  return { ok: true };
}
