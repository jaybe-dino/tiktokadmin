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
    // 신규 리드 자동 안내(문자·메일) — welcome_config 활성 + 대상 소스일 때 1회
    if (res.created && res.brand_id) {
      const { maybeAutoWelcome } = await import("@/lib/welcome");
      await maybeAutoWelcome(res.brand_id, String(input.source ?? "etc")).catch(() => {});
    }
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
  const { detectImportRecord } = await import("@/lib/field-detect");
  const rows = parseCsv(csvText);
  let created = 0, updated = 0, skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    // 어떤 헤더든 자동 인식(퍼지 매칭)
    const rec = detectImportRecord(rows[i]);
    const res = await importBrandRecord(a.actor, rec);
    if (res.ok) {
      if (res.created) {
        created++;
        // 신규 리드 자동 안내(문자·메일) — welcome_config 활성 + 대상 소스일 때 1회(멱등)
        if (res.brand_id) {
          const { maybeAutoWelcome } = await import("@/lib/welcome");
          await maybeAutoWelcome(res.brand_id, String(rec.source ?? "etc")).catch(() => {});
        }
      } else updated++;
    } else {
      skipped++;
      if (errors.length < 10) errors.push(`행 ${i + 2}: ${res.error}`);
    }
  }
  revalidatePath("/");
  return { ok: true, created, updated, skipped, errors };
}

const EDITABLE_FIELDS = [
  "brand_name", "brand_name_en", "email", "phone", "biz_no",
  "contact_name", "category", "brand_url", "memo", "next_action", "due_date",
] as const;

export async function updateBrandAction(
  brandId: string,
  fields: Partial<Record<(typeof EDITABLE_FIELDS)[number], string>>,
): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { query } = await import("@/lib/db");
  const sets: string[] = [];
  const vals: unknown[] = [brandId];
  for (const key of EDITABLE_FIELDS) {
    if (fields[key] === undefined) continue;
    vals.push(fields[key] === "" ? null : fields[key]);
    sets.push(`${key} = $${vals.length}`);
  }
  if (sets.length === 0) return { ok: true };
  try {
    await query(`UPDATE brands SET ${sets.join(", ")} WHERE id=$1`, vals);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, error: "이메일/사업자번호가 다른 브랜드와 중복됩니다." };
    }
    return { ok: false, error: msg };
  }
  revalidatePath(`/brand/${brandId}`);
  revalidatePath("/");
  return { ok: true };
}

// ── 고객 자료·제안서·국가 (M6) ──────────────────────────────
export async function addFileAction(input: {
  brandId: string; kind: string; label: string; url: string; note?: string;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  if (!input.url?.trim() || !input.label?.trim()) return { ok: false, error: "제목과 링크가 필요합니다." };
  const { addFile } = await import("@/lib/repo/customer");
  await addFile({
    brand_id: input.brandId, kind: input.kind as never, label: input.label,
    url: input.url, note: input.note, by: a.actor,
  });
  revalidatePath(`/brand/${input.brandId}`);
  return { ok: true };
}

export async function deleteFileAction(brandId: string, id: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { deleteFile } = await import("@/lib/repo/customer");
  await deleteFile(id);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function addProposalAction(input: {
  brandId: string; title: string; url?: string; amount?: number; note?: string;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  if (!input.title?.trim()) return { ok: false, error: "제안서 제목이 필요합니다." };
  const { addProposal } = await import("@/lib/repo/customer");
  await addProposal({ brand_id: input.brandId, title: input.title, url: input.url, amount: input.amount, note: input.note, by: a.actor });
  revalidatePath(`/brand/${input.brandId}`);
  return { ok: true };
}

export async function setProposalStatusAction(brandId: string, id: string, status: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { setProposalStatus } = await import("@/lib/repo/customer");
  await setProposalStatus(id, status);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function deleteProposalAction(brandId: string, id: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { deleteProposal } = await import("@/lib/repo/customer");
  await deleteProposal(id);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function setCountriesAction(brandId: string, countries: string[], certified: string[]): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { setCountries, setCertifiedCountries } = await import("@/lib/repo/customer");
  await setCountries(brandId, countries);
  await setCertifiedCountries(brandId, certified);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function deleteBrandAction(brandId: string): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (삭제는 파트장/대표만)" };
  const { query } = await import("@/lib/db");
  await query("DELETE FROM brands WHERE id=$1", [brandId]); // 연관 테이블 CASCADE
  revalidatePath("/");
  return { ok: true };
}

/** 브랜드 원장 일괄 삭제(체크 선택). 파트장/대표만. 연관 데이터 CASCADE.
 *   ⚠️ 완전삭제 — glovek 원본 고객은 동기화로 복원될 수 있음(테스트 데이터 정리용). */
export async function deleteBrandsAction(ids: string[]): Promise<ActionResult & { deleted?: number }> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (삭제는 파트장/대표만)" };
  const clean = (ids ?? []).filter((s) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s));
  if (clean.length === 0) return { ok: false, error: "선택된 항목 없음" };
  const { query } = await import("@/lib/db");
  const r = await query<{ id: string }>("DELETE FROM brands WHERE id = ANY($1) RETURNING id", [clean]);
  revalidatePath("/customers");
  revalidatePath("/");
  return { ok: true, deleted: r.length };
}

/** 브랜드 원장 일괄 제외(dropped) — soft delete. 목록에서 숨기고 동기화 복원 방지(행 유지).
 *   완전삭제와 달리 glovek 재동기화 시 기존 dropped 행이 갱신될 뿐 되살아나지 않음. */
export async function dropBrandsAction(ids: string[]): Promise<ActionResult & { dropped?: number }> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const clean = (ids ?? []).filter((s) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s));
  if (clean.length === 0) return { ok: false, error: "선택된 항목 없음" };
  const { query } = await import("@/lib/db");
  const r = await query<{ id: string }>(
    "UPDATE brands SET state='dropped', stage_entered_at=now() WHERE id = ANY($1) AND state NOT IN ('dropped','churned') RETURNING id",
    [clean]);
  // 활성 알림 해제(드랍 브랜드가 SLA 지표 오염 방지)
  await query("UPDATE alerts SET resolved_at=now() WHERE brand_id = ANY($1) AND resolved_at IS NULL", [clean]).catch(() => {});
  // 감사 이력
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       SELECT unnest($1::uuid[]), 'admin', 'transition', '{"to":"dropped","by":"bulk"}'::jsonb, now()`,
    [clean]).catch(() => {});
  revalidatePath("/customers");
  revalidatePath("/");
  return { ok: true, dropped: r.length };
}

export async function attachEmailAction(input: {
  brandId: string; from?: string; subject?: string; text?: string; direction?: "in" | "out";
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { linkEmail } = await import("@/lib/email-link");
  await linkEmail(
    { brand_id: input.brandId, from: input.from, subject: input.subject, text: input.text, direction: input.direction },
    a.actor,
  );
  revalidatePath(`/brand/${input.brandId}`);
  return { ok: true };
}

export async function deleteEmailAction(brandId: string, id: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { query } = await import("@/lib/db");
  await query("DELETE FROM brand_emails WHERE id=$1", [id]);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function mergeBrandsAction(keepId: string, dropId: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { mergeBrands } = await import("@/lib/merge");
  const res = await mergeBrands(keepId, dropId, a.actor);
  revalidatePath("/duplicates");
  revalidatePath("/");
  revalidatePath(`/brand/${keepId}`);
  return res;
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
  id: string; name: string; role: string; slack_user_id?: string; password?: string;
}): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const id = (input.id || "").trim().toLowerCase();
  if (!id.includes("@")) return { ok: false, error: "이메일 형식의 계정 ID 필요" };
  // /accounts 와 동일한 역할 검증 — DB CHECK 제약과 일치.
  const OK_ROLES = new Set(["intake", "sales", "onboard", "ads", "settle", "lead", "exec"]);
  if (!OK_ROLES.has(input.role)) return { ok: false, error: "권한 값이 올바르지 않습니다" };
  try {
    const { query } = await import("@/lib/db");
    await query(
      `INSERT INTO admin_users (id, name, role, slack_user_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, slack_user_id=EXCLUDED.slack_user_id`,
      [id, input.name.trim() || id.split("@")[0], input.role, input.slack_user_id || null],
    );
    // 비밀번호 지정 시 해시 저장(신규 계정 로그인 가능해짐)
    if (input.password && input.password.trim().length >= 6) {
      const { setPassword } = await import("@/lib/auth");
      await setPassword(id, input.password.trim());
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "저장 실패" };
  }
  revalidatePath("/settings");
  revalidatePath("/accounts");
  return { ok: true };
}

/** 비밀번호 재설정 (파트장/대표: 임의 계정 / 본인: 자기 계정). */
export async function setPasswordAction(email: string, password: string): Promise<ActionResult> {
  const me = await actor();
  if (!me) return { ok: false, error: "세션 만료" };
  const target = email.trim().toLowerCase();
  const lead = await requireLead();
  if (!lead && me.actor !== target) return { ok: false, error: "권한 없음 (본인 또는 파트장/대표만)" };
  if (!password || password.trim().length < 6) return { ok: false, error: "비밀번호는 6자 이상" };
  const { setPassword } = await import("@/lib/auth");
  await setPassword(target, password.trim());
  revalidatePath("/settings");
  revalidatePath("/accounts");
  return { ok: true };
}

// ═══ 계정 관리 (파트장/대표) — 권한·활성·삭제·zoom_email ══════════
// admin_users.role CHECK 제약과 반드시 일치해야 함(0001_init).
const VALID_ROLES = new Set(["intake", "sales", "onboard", "ads", "settle", "lead", "exec"]);

/** 계정 생성/수정 — 이메일·이름·권한·zoom_email·(선택)비번. */
export async function saveAccountAction(input: {
  id: string; name: string; role: string; zoom_email?: string; password?: string;
}): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const id = (input.id || "").trim().toLowerCase();
  if (!id.includes("@")) return { ok: false, error: "이메일 형식의 계정 ID 필요" };
  if (!VALID_ROLES.has(input.role)) return { ok: false, error: "권한 값이 올바르지 않습니다" };
  try {
    const { query } = await import("@/lib/db");
    await query(
      `INSERT INTO admin_users (id, name, role, zoom_email, active) VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, zoom_email=EXCLUDED.zoom_email`,
      [id, input.name.trim() || id.split("@")[0], input.role, (input.zoom_email || "").trim().toLowerCase() || null]);
    if (input.password && input.password.trim().length >= 6) {
      const { setPassword } = await import("@/lib/auth");
      await setPassword(id, input.password.trim());
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "저장 실패" };
  }
  revalidatePath("/accounts");
  return { ok: true };
}

/** 계정 활성/비활성 토글. 본인·마지막 exec 잠금 방지. */
export async function setAccountActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const me = await requireLead();
  if (!me) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const target = (id || "").trim().toLowerCase();
  if (!active && me.actor === target) return { ok: false, error: "본인 계정은 비활성화할 수 없습니다" };
  try {
    const { query, queryOne } = await import("@/lib/db");
    if (!active) {
      const execs = await queryOne<{ n: string }>("SELECT count(*)::text n FROM admin_users WHERE role='exec' AND active=true AND id<>$1", [target]);
      if (Number(execs?.n ?? 0) === 0) return { ok: false, error: "마지막 활성 대표(exec)는 비활성화 불가" };
    }
    await query("UPDATE admin_users SET active=$2 WHERE id=$1", [target, active]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "변경 실패" };
  }
  revalidatePath("/accounts");
  return { ok: true };
}

/** 계정 삭제 — 본인·마지막 exec 방지, 담당 지정은 해제. */
export async function deleteAccountAction(id: string): Promise<ActionResult> {
  const me = await requireLead();
  if (!me) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const target = (id || "").trim().toLowerCase();
  if (me.actor === target) return { ok: false, error: "본인 계정은 삭제할 수 없습니다" };
  try {
    const { query, queryOne } = await import("@/lib/db");
    const isExec = await queryOne<{ role: string }>("SELECT role FROM admin_users WHERE id=$1", [target]);
    if (isExec?.role === "exec") {
      const execs = await queryOne<{ n: string }>("SELECT count(*)::text n FROM admin_users WHERE role='exec' AND id<>$1", [target]);
      if (Number(execs?.n ?? 0) === 0) return { ok: false, error: "마지막 대표(exec)는 삭제 불가" };
    }
    // 담당 지정 해제(원장 owner_* 가 이 계정을 가리키면 NULL)
    await query(
      `UPDATE brands SET owner_intake=NULLIF(owner_intake,$1), owner_sales=NULLIF(owner_sales,$1),
         owner_onboard=NULLIF(owner_onboard,$1), owner_ads=NULLIF(owner_ads,$1)
       WHERE $1 IN (owner_intake,owner_sales,owner_onboard,owner_ads)`, [target]).catch(() => {});
    await query("DELETE FROM admin_users WHERE id=$1", [target]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "삭제 실패" };
  }
  revalidatePath("/accounts");
  return { ok: true };
}

// ═══ Phase 2 · 고객카드 심화 액션 (10 + 14) ═══════════════════
import {
  addContact as repoAddContact, deleteContact as repoDeleteContact, syncPrimaryContact,
  addProduct as repoAddProduct, upsertCert as repoUpsertCert,
  addProposalV2, addContract as repoAddContract, setContractStatus,
  upsertLogistics as repoUpsertLogistics, createSurvey, upsertCompany, addAsset,
} from "@/lib/repo/card";
import { computeQuote, type QuoteTerm } from "@/lib/quote";

export async function addContactAction(input: {
  brand_id: string; name: string; title?: string; email?: string; phone?: string;
  role?: string; is_primary?: boolean;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await repoAddContact(input);
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true };
}

export async function deleteContactAction(brandId: string, id: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await repoDeleteContact(id);
  await syncPrimaryContact(brandId).catch(() => {});
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

/** 연락처 수신동의 체크(직원이 서면·구두 동의 확보 시). 근거='admin' 기록. */
export async function setContactConsentAction(
  brandId: string, id: string, consent: boolean,
): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const { query } = await import("@/lib/db");
  await query(
    `UPDATE brand_contacts SET marketing_consent=$2,
       consent_at=CASE WHEN $2 THEN now() ELSE NULL END,
       consent_source=CASE WHEN $2 THEN 'admin' ELSE NULL END
     WHERE id=$1 AND brand_id=$3`,
    [id, consent, brandId]);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function addProductAction(input: {
  brand_id: string; name_kr: string; name_en?: string; category?: string; sku?: string; price_band?: string;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await repoAddProduct(input);
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true };
}

export async function upsertCertAction(brandId: string, input: {
  product_id: string; country: string; cert_type: string; status?: string;
  cert_number?: string; expires_at?: string | null;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await repoUpsertCert(input);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

/** 제안서 생성 — computeQuote 단일 원천(수기 금액 금지). */
export async function createProposalAction(input: {
  brand_id: string; plan: string; countries: string[]; term: QuoteTerm; onboardingTier?: string;
}): Promise<ActionResult & { quote?: number; breakdown?: string }> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const q = computeQuote({
    plan: input.plan, countries: input.countries, term: input.term,
    onboardingTier: input.onboardingTier as "3month" | "5month" | "12month" | undefined,
  });
  await addProposalV2({
    brand_id: input.brand_id, plan: input.plan, countries: input.countries,
    term: input.term, quote_amount: q.total, discount_note: q.breakdown, by: a.actor,
  });
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true, quote: q.total, breakdown: q.breakdown };
}

export async function addContractAction(input: {
  brand_id: string; kind: string; fee_pct?: number; term_months?: number;
  countries?: string[]; start_date?: string; end_date?: string; note?: string;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  try {
    await repoAddContract({
      brand_id: input.brand_id, kind: input.kind,
      terms: { fee_pct: input.fee_pct ?? null, term_months: input.term_months ?? null, countries: input.countries ?? [] },
      start_date: input.start_date || null, end_date: input.end_date || null, note: input.note,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "계약 등록 실패" };
  }
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true };
}

export async function setContractStatusAction(brandId: string, id: string, status: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await setContractStatus(id, status);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function upsertLogisticsAction(input: {
  brand_id: string; country: string; provider?: string; status?: string;
  warehouse_region?: string; end_date?: string;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await repoUpsertLogistics({ ...input, end_date: input.end_date || null });
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true };
}

/** 설문 생성 → 공개 링크 반환(팔로업 메일에 삽입). */
export async function createSurveyAction(brandId: string): Promise<ActionResult & { url?: string }> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const token = await createSurvey(brandId);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true, url: `/s/${token}` };
}

export async function saveCompanyAction(brandId: string, patch: Record<string, unknown>): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await upsertCompany(brandId, patch);
  revalidatePath(`/brand/${brandId}`);
  return { ok: true };
}

export async function addAssetLinkAction(input: {
  brand_id: string; kind: string; filename: string; external_url: string;
}): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await addAsset({ ...input, source: "drive", by: a.actor });
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true };
}

// ═══ Phase 4 · 초안함 (Drafts Inbox) ═════════════════════════
import { approveAndSend, discardDraft, editDraft, saveToGmailDraft } from "@/lib/drafts";

export async function approveDraftAction(
  id: string, edits?: { subject?: string; body?: string },
): Promise<ActionResult & { sent?: boolean }> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const r = await approveAndSend(id, a.actor, edits);
  revalidatePath("/drafts");
  return { ok: r.ok, error: r.error, sent: r.sent };
}

/** Gmail 임시저장 — 지정 공용 메일함의 임시보관함에 초안 저장(담당자가 Gmail 에서 발송). */
export async function saveGmailDraftAction(
  id: string, edits?: { subject?: string; body?: string },
): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const r = await saveToGmailDraft(id, a.actor, edits);
  revalidatePath("/drafts");
  return { ok: r.ok, error: r.error };
}

export async function editDraftAction(id: string, subject: string, body: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await editDraft(id, subject, body, a.actor);
  revalidatePath("/drafts");
  return { ok: true };
}

export async function discardDraftAction(id: string): Promise<ActionResult> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  await discardDraft(id);
  revalidatePath("/drafts");
  return { ok: true };
}

// ═══ 문자 발송 (Aligo SMS) ═════════════════════════════════════
import { sendSms } from "@/lib/sms";
import { canSend } from "@/lib/lifecycle";

export async function sendSmsAction(input: {
  brand_id?: string; receiver: string; msg: string; kind?: string; test?: boolean;
}): Promise<ActionResult & { msgId?: string; type?: string }> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  if (!input.receiver?.trim() || !input.msg?.trim()) return { ok: false, error: "수신번호·내용 필수" };

  // 수신동의 게이트(17 §5) — 진입점 무관 항상 검사. kind 미지정=개별 1:1 수동('manual', 거래성).
  //   광고성 대량(campaign 등)만 동의 필요. 이렇게 통일해 진입점별 우회/과차단 제거.
  const kind = input.kind ?? "manual";
  if (input.brand_id) {
    const gate = await canSend(input.brand_id, kind, input.receiver);
    if (!gate.ok) return { ok: false, error: gate.reason };
  }

  const res = await sendSms({ receiver: input.receiver, msg: input.msg, testmode: input.test });
  if (!res.ok) return { ok: false, error: res.message };

  // 발송 기록: contact_logged(sms) + last_contact_at — 단, 테스트 발송은 접촉기록 제외.
  if (input.brand_id && !input.test) {
    const { query } = await import("@/lib/db");
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'admin','contact_logged',$2,now())`,
      [input.brand_id, JSON.stringify({ channel: "sms", kind: input.kind ?? "manual", msg_id: res.msgId })],
    ).catch(() => {});
    await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [input.brand_id]).catch(() => {});
  }
  return { ok: true, msgId: res.msgId, type: res.type };
}

// ═══ 대화맥락 기반 AI 메일 초안 ═══════════════════════════════
import { draftContextualEmail } from "@/lib/email-compose";

export async function composeEmailAction(brandId: string, intent?: string): Promise<ActionResult & { subject?: string }> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const r = await draftContextualEmail(brandId, intent);
  revalidatePath(`/brand/${brandId}`);
  revalidatePath("/drafts");
  return { ok: r.ok, error: r.error, subject: r.subject };
}

// ═══ AI 에이전트 관리 ═════════════════════════════════════════
import { runAgent as runAgentFn, setAgentEnabled } from "@/lib/agents";

export async function runAgentAction(key: string): Promise<ActionResult & { summary?: string }> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const r = await runAgentFn(key, "manual");
  revalidatePath("/agents");
  return { ok: r.ok, error: r.error, summary: r.summary };
}

export async function toggleAgentAction(key: string, enabled: boolean): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  await setAgentEnabled(key, enabled);
  revalidatePath("/agents");
  return { ok: true };
}

// ═══ 회사 공용 메일함 관리 (파트장/대표) ═══════════════════════
import { upsertMailbox, setMailboxEnabled, setMailboxForward, removeMailbox, setMailboxDefault } from "@/lib/shared-mailboxes";

export async function addMailboxAction(email: string, label: string, note?: string): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  try { await upsertMailbox(email, label, note ?? ""); }
  catch (e) { return { ok: false, error: (e as Error).message }; }
  revalidatePath("/settings");
  return { ok: true };
}

export async function toggleMailboxAction(email: string, field: "enabled" | "forward" | "default", value: boolean): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  try {
    if (field === "enabled") await setMailboxEnabled(email, value);
    else if (field === "default") await setMailboxDefault(email);  // 하나만 — 나머지 자동 해제
    else await setMailboxForward(email, value);
  } catch (e) {
    // 예: 마이그레이션 0024 미적용(is_default 컬럼 없음) — 화면 크래시 대신 안내.
    const msg = (e as Error).message;
    return { ok: false, error: /is_default/.test(msg) ? "마이그레이션 필요(0024) — /api/admin/migrate 실행 후 재시도" : msg };
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeMailboxAction(email: string): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  await removeMailbox(email);
  revalidatePath("/settings");
  return { ok: true };
}

// ═══ 유입 채널(주제별 키) 관리 (파트장/대표) ═══════════════════
import { createChannel, updateChannel, deleteChannel, type IntakeChannel } from "@/lib/intake-channels";

export async function createChannelAction(input: {
  name: string; source: string; note?: string;
}): Promise<ActionResult & { key?: string }> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  if (!input.name?.trim()) return { ok: false, error: "채널명 필수" };
  const ch = await createChannel({ name: input.name, source: input.source || "meta_ads", note: input.note, createdBy: a.actor });
  revalidatePath("/settings");
  return { ok: Boolean(ch), key: ch?.key, error: ch ? undefined : "생성 실패(마이그레이션 0027 확인)" };
}

export async function updateChannelAction(id: string, patch: Partial<IntakeChannel>): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  try { await updateChannel(id, patch); }
  catch (e) { return { ok: false, error: (e as Error).message }; }
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteChannelAction(id: string): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  await deleteChannel(id);
  revalidatePath("/settings");
  return { ok: true };
}

// ═══ 신규 리드 자동 안내 (파트장/대표) ═════════════════════════
import { saveWelcomeConfig, sendWelcome, type WelcomeConfig } from "@/lib/welcome";

export async function saveWelcomeConfigAction(cfg: Partial<WelcomeConfig>): Promise<ActionResult> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  await saveWelcomeConfig(cfg);
  revalidatePath("/settings");
  return { ok: true };
}

/** 수동 안내 발송(리드 목록/브랜드360에서). 기본 1회, force 로 재발송. */
export async function sendWelcomeAction(brandId: string, force = false): Promise<ActionResult & { sent?: string[]; skipped?: string }> {
  const a = await actor();
  if (!a) return { ok: false, error: "세션 만료" };
  const r = await sendWelcome(brandId, force);
  revalidatePath(`/brand/${brandId}`);
  return { ok: r.ok, error: r.error, sent: r.sent, skipped: r.skipped };
}

/** 테스트 발송 — 내 번호/이메일로 문자·메일을 직접 보내 연동(ALIGO·RESEND) 동작 확인. */
export async function testNotifyAction(input: { phone?: string; email?: string; slack?: boolean }): Promise<ActionResult & { sms?: string; email?: string; slack?: string }> {
  const a = await requireLead();
  if (!a) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  let sms: string | undefined, email: string | undefined, slack: string | undefined;
  if (input.slack) {
    const { slackPost } = await import("@/lib/slack");
    const { env } = await import("@/lib/env");
    if (!env.slack.botToken) slack = "✗ SLACK_BOT_TOKEN 미설정";
    else {
      const r = await slackPost({ channelKey: "daily", text: "[GloveK] 테스트 알림입니다. Slack 연동 확인용." });
      slack = r.ok ? `✓ 발송 성공(#${r.channel ?? "daily"})` : "✗ 발송 실패(채널 미설정 또는 봇 미초대 — SLACK_CH_DAILY 확인)";
    }
  }
  if (input.phone?.trim()) {
    const { sendSms } = await import("@/lib/sms");
    const { env } = await import("@/lib/env");
    const r = await sendSms({ receiver: input.phone.trim(), msg: "[GloveK] 테스트 문자입니다. 연동 확인용." });
    if (r.ok && env.aligo.testMode) sms = "⚠ 접수됨(테스트모드 — 실제 발송 안 됨). ALIGO_TEST_MODE=N 후 재배포 필요";
    else sms = r.ok ? `✓ 발송 성공(${r.type ?? "SMS"})` : `✗ ${r.message}`;
  }
  if (input.email?.trim()) {
    const { sendEmail } = await import("@/lib/mailer");
    const r = await sendEmail({ to: input.email.trim(), subject: "[GloveK] 테스트 메일", text: "GloveK 어드민 연동 확인용 테스트 메일입니다." });
    email = r.ok ? "✓ 발송 성공" : r.skipped ? "✗ RESEND_API_KEY 미설정" : `✗ ${r.error}`;
  }
  return { ok: true, sms, email, slack };
}
