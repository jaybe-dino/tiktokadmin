"use server";
// 발송제외(수신거부) 명단 — 조회·수동 등록·해제·이력.
//
//   일부러 하지 않는 것
//     · 고객에게 문자·메일을 보내지 않는다. 이 화면은 "보내지 않을 사람"만 다룬다.
//     · 원문 주소를 화면으로 돌려주지 않는다 — 전부 마스킹 값이다.
//     · 고객이 직접 누른 수신거부(source='link')는 해제하지 않는다.
//     · 브랜드 원장(brands)·자동발송 설정·cron 을 건드리지 않는다.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import {
  optOutSchemaState, listOptOuts, optOutCounts, addOptOutManual, addOptOutsBulk,
  removeOptOut, listOptOutEvents, OPTOUT_ADMIN_MIGRATION,
  type OptOutList, type OptOutCounts, type OptOutEventRow, type OptOutAdminResult,
  type BulkOptOutResult,
} from "@/lib/ad-optout";

const EDIT_ROLES = new Set(["exec", "lead"]);

async function me() {
  const u = await currentUser().catch(() => null);
  return u ? { ok: true as const, user: u } : { ok: false as const, error: "권한이 없습니다." };
}
async function editor() {
  const a = await me();
  if (!a.ok) return a;
  if (!EDIT_ROLES.has(a.user.role)) return { ok: false as const, error: "대표·파트장만 바꿀 수 있습니다." };
  return a;
}
const actorOf = (u: { name?: string | null; email?: string | null; id: string }) =>
  (u.name ?? "").trim() || (u.email ?? "").trim() || u.id;

export interface OptOutOverview {
  schemaReady: boolean; schemaError?: string; migration: string;
  counts: OptOutCounts;
  list: OptOutList;
  events: OptOutEventRow[];
  canEdit: boolean;
}

export async function optOutOverviewAction(
  opts: { q?: string; kind?: string; page?: number } = {},
): Promise<{ ok: boolean; error?: string; data?: OptOutOverview }> {
  const a = await me();
  if (!a.ok) return a;
  const canEdit = EDIT_ROLES.has(a.user.role);
  const schema = await optOutSchemaState();
  if (!schema.ready) {
    return {
      ok: true,
      data: {
        schemaReady: false,
        schemaError: `마이그레이션 ${OPTOUT_ADMIN_MIGRATION} 미적용 — 없는 표: ${schema.missing.join(", ") || schema.error || "확인 실패"}`,
        migration: OPTOUT_ADMIN_MIGRATION,
        counts: { total: 0, email: 0, phone: 0, bySource: {} },
        list: { rows: [], total: 0, page: 1, pageSize: 50, pages: 1 },
        events: [], canEdit,
      },
    };
  }
  try {
    const [counts, list, events] = await Promise.all([
      optOutCounts(),
      listOptOuts({ q: opts.q, kind: opts.kind, page: opts.page }),
      listOptOutEvents(50),
    ]);
    return { ok: true, data: { schemaReady: true, migration: OPTOUT_ADMIN_MIGRATION, counts, list, events, canEdit } };
  } catch (e) {
    // 조회 실패를 빈 명단으로 숨기지 않는다.
    return { ok: false, error: `명단 조회 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

export async function addOptOutAction(value: string, reason: string): Promise<OptOutAdminResult> {
  const a = await editor();
  if (!a.ok) return { ok: false, error: a.error };
  const r = await addOptOutManual({ value, reason }, actorOf(a.user));
  if (r.ok) revalidatePath("/optouts");
  return r;
}

export async function addOptOutsBulkAction(raw: string, reason: string): Promise<BulkOptOutResult & { error?: string }> {
  const a = await editor();
  if (!a.ok) return { ok: false, added: 0, already: 0, failed: [], note: "", error: a.error };
  const r = await addOptOutsBulk(raw, reason, actorOf(a.user));
  if (r.added || r.already) revalidatePath("/optouts");
  if (!r.ok && r.added === 0 && r.already === 0 && r.failed.length === 0) {
    return { ...r, error: "등록할 주소를 입력하세요(한 줄에 하나)." };
  }
  return r;
}

export async function removeOptOutAction(id: string, reason: string): Promise<OptOutAdminResult> {
  const a = await editor();
  if (!a.ok) return { ok: false, error: a.error };
  const r = await removeOptOut(id, reason, actorOf(a.user));
  if (r.ok) revalidatePath("/optouts");
  return r;
}
