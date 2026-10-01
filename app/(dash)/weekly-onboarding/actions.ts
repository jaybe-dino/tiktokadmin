"use server";
// 주간 온보딩 신청 목록(관리자). 조회·상태/담당/메모 변경만 한다.
//   이 파일에는 고객에게 보내는 경로가 없다 — 연락은 직원이 전화·메일로 직접 한다.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  weeklySchemaState, listWeeklyApplications, weeklyCounts,
  setWeeklyStatus, setWeeklyOwner, setWeeklyNote, deleteWeeklyTestRows,
  WEEKLY_SCHEMA_MIGRATION, WEEKLY_SLOTS,
} from "@/lib/weekly-onboarding";

const ADMIN_ROLES = new Set(["exec", "lead"]);

export interface WeeklyOverview {
  schemaReady: boolean;
  schemaError?: string;
  migration: string;
  slots: number;
  rows: Awaited<ReturnType<typeof listWeeklyApplications>>;
  counts: Awaited<ReturnType<typeof weeklyCounts>> | null;
  admins: { id: string; name: string }[];
  canAdmin: boolean;
  formPath: string;
}

export async function weeklyOverviewAction(includeTest = false):
  Promise<{ ok: boolean; error?: string; data?: WeeklyOverview }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const schema = await weeklySchemaState();
  if (!schema.ready) {
    return {
      ok: true,
      data: {
        schemaReady: false,
        schemaError: `마이그레이션 ${WEEKLY_SCHEMA_MIGRATION} 미적용 — 없는 표: ${schema.missing.join(", ") || schema.error || "확인 실패"}`,
        migration: WEEKLY_SCHEMA_MIGRATION, slots: WEEKLY_SLOTS,
        rows: [], counts: null, admins: [], canAdmin: ADMIN_ROLES.has(u.role), formPath: "/weekly",
      },
    };
  }
  try {
    const [rows, counts, admins] = await Promise.all([
      listWeeklyApplications({ includeTest }),
      weeklyCounts(),
      query<{ id: string; name: string }>(
        "SELECT id, name FROM admin_users WHERE active ORDER BY name LIMIT 200").catch(() => []),
    ]);
    return {
      ok: true,
      data: {
        schemaReady: true, migration: WEEKLY_SCHEMA_MIGRATION, slots: WEEKLY_SLOTS,
        rows, counts, admins, canAdmin: ADMIN_ROLES.has(u.role), formPath: "/weekly",
      },
    };
  } catch (e) {
    return { ok: false, error: `신청 목록을 불러오지 못했습니다 — ${(e as Error).message.slice(0, 200)}` };
  }
}

async function actor() {
  const u = await currentUser();
  return u ? { ok: true as const, user: u } : { ok: false as const, error: "권한이 없습니다." };
}

export async function weeklySetStatusAction(id: string, status: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await actor();
  if (!a.ok) return a;
  const r = await setWeeklyStatus(id, status, a.user.id);
  if (r.ok) revalidatePath("/weekly-onboarding");
  return r.ok ? { ok: true, note: "상태를 바꿨습니다." } : r;
}

export async function weeklySetOwnerAction(id: string, owner: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await actor();
  if (!a.ok) return a;
  const r = await setWeeklyOwner(id, owner || null, a.user.id);
  if (r.ok) revalidatePath("/weekly-onboarding");
  return r.ok ? { ok: true, note: "담당을 지정했습니다." } : r;
}

export async function weeklySetNoteAction(id: string, note: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await actor();
  if (!a.ok) return a;
  const r = await setWeeklyNote(id, note, a.user.id);
  if (r.ok) revalidatePath("/weekly-onboarding");
  return r.ok ? { ok: true, note: "메모를 저장했습니다." } : r;
}

/** 검수용 합성 데이터(TEST)만 지운다. 실제 신청은 이 경로로 지워지지 않는다. */
export async function weeklyClearTestAction(): Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await actor();
  if (!a.ok) return a;
  if (!ADMIN_ROLES.has(a.user.role)) return { ok: false, error: "대표·파트장만 지울 수 있습니다." };
  try {
    const r = await deleteWeeklyTestRows();
    revalidatePath("/weekly-onboarding");
    return { ok: true, note: `검수용 TEST 데이터 ${r.deleted}건을 지웠습니다(실제 신청은 그대로입니다).` };
  } catch (e) {
    return { ok: false, error: `삭제 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}
