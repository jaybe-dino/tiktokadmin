"use server";
// 세미나 모집 관리(관리자). 행사·포스터·신청자·외부 공유 설정만 다룬다.
//
//   일부러 하지 않는 것
//     · 브랜드 원장(brands)·리드·자동발송을 건드리지 않는다.
//     · 고객에게 문자·메일을 보내지 않는다.
//     · 공유 비밀번호를 만들어 넣거나 공유를 자동으로 켜지 않는다 — 전부 관리자 조작이다.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  sevSchemaState, listAllEvents, getEvent, saveEvent, setEventFlags, clearPoster,
  listRegistrations, regCounts, setRegStatus, setRegNote, setRegOwner,
  addTestRegistration, deleteSevTestRegs, eventTaken,
  SEV_MIGRATION, type EventInput, type SevEvent, type RegListResult, type RegCounts,
} from "@/lib/seminar-events";
import {
  listShares, createShare, setSharePassword, setShareFields, setShareEnabled,
  setShareExpiry, rotateShareToken, revokeShare, revokeShareSessions, type SevShare,
} from "@/lib/seminar-event-share";

const EDIT_ROLES = new Set(["exec", "lead"]);
/** 외부 공유는 최종 관리자(대표)만 만들고 켤 수 있다. */
const SHARE_ROLES = new Set(["exec"]);

async function me() {
  const u = await currentUser().catch(() => null);
  return u ? { ok: true as const, user: u } : { ok: false as const, error: "권한이 없습니다." };
}
async function editor() {
  const a = await me();
  if (!a.ok) return a;
  if (!EDIT_ROLES.has(a.user.role)) return { ok: false as const, error: "대표·파트장만 수정할 수 있습니다." };
  return a;
}
async function sharer() {
  const a = await me();
  if (!a.ok) return a;
  if (!SHARE_ROLES.has(a.user.role)) return { ok: false as const, error: "외부 공유 설정은 대표만 할 수 있습니다." };
  return a;
}
const done = (note: string) => { revalidatePath("/seminar-events"); return { ok: true as const, note }; };

// ── 개요 ─────────────────────────────────────────────────────
export interface SevOverview {
  schemaReady: boolean; schemaError?: string; migration: string;
  events: SevEvent[];
  canEdit: boolean; canShare: boolean;
  hubPath: string;
}
export async function sevOverviewAction(): Promise<{ ok: boolean; error?: string; data?: SevOverview }> {
  const a = await me();
  if (!a.ok) return a;
  const schema = await sevSchemaState();
  if (!schema.ready) {
    return {
      ok: true,
      data: {
        schemaReady: false,
        schemaError: `마이그레이션 ${SEV_MIGRATION} 미적용 — 없는 표: ${schema.missing.join(", ") || schema.error || "확인 실패"}`,
        migration: SEV_MIGRATION, events: [],
        canEdit: EDIT_ROLES.has(a.user.role), canShare: SHARE_ROLES.has(a.user.role),
        hubPath: "/events",
      },
    };
  }
  try {
    return {
      ok: true,
      data: {
        schemaReady: true, migration: SEV_MIGRATION,
        events: await listAllEvents(),
        canEdit: EDIT_ROLES.has(a.user.role), canShare: SHARE_ROLES.has(a.user.role),
        hubPath: "/events",
      },
    };
  } catch (e) {
    return { ok: false, error: `행사 목록을 불러오지 못했습니다 — ${(e as Error).message.slice(0, 180)}` };
  }
}

export interface SevEventDetail {
  event: SevEvent;
  regs: RegListResult;
  counts: RegCounts;
  taken: number;
  shares: SevShare[];
  admins: { id: string; name: string }[];
}
export async function sevEventDetailAction(
  eventId: string,
  opts: { q?: string; status?: string; page?: number; pageSize?: number; includeTest?: boolean } = {},
): Promise<{ ok: boolean; error?: string; data?: SevEventDetail }> {
  const a = await me();
  if (!a.ok) return a;
  const event = await getEvent(eventId).catch(() => null);
  if (!event) return { ok: false, error: "행사를 찾지 못했습니다." };
  try {
    const [regs, counts, taken, shares, admins] = await Promise.all([
      listRegistrations({ eventId, ...opts }),
      regCounts(eventId),
      eventTaken(eventId),
      // 공유 설정은 대표만 본다(비밀번호 해시는 어떤 경우에도 내보내지 않는다).
      SHARE_ROLES.has(a.user.role) ? listShares(eventId) : Promise.resolve([] as SevShare[]),
      query<{ id: string; name: string }>(
        "SELECT id, name FROM admin_users WHERE active ORDER BY name LIMIT 200").catch(() => []),
    ]);
    return { ok: true, data: { event, regs, counts, taken, shares, admins } };
  } catch (e) {
    return { ok: false, error: `불러오지 못했습니다 — ${(e as Error).message.slice(0, 180)}` };
  }
}

// ── 행사 ─────────────────────────────────────────────────────
export async function sevSaveEventAction(input: EventInput):
  Promise<{ ok: boolean; error?: string; note?: string; id?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  const r = await saveEvent(input, a.user.id);
  if (!r.ok) return r;
  revalidatePath("/seminar-events");
  revalidatePath("/events");
  return { ok: true, note: input.id ? "행사를 수정했습니다." : "행사를 만들었습니다.", id: r.id };
}

export async function sevSetFlagsAction(id: string, patch: { status?: string; publish?: boolean; apply_open?: boolean }):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  const r = await setEventFlags(id, patch);
  if (!r.ok) return r;
  revalidatePath("/seminar-events");
  revalidatePath("/events");
  return { ok: true, note: "반영했습니다." };
}

export async function sevClearPosterAction(id: string): Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  const r = await clearPoster(id);
  if (!r.ok) return r;
  revalidatePath("/events");
  return done("포스터 연결을 해제했습니다(파일은 이력으로 남습니다).");
}

// ── 신청자 ───────────────────────────────────────────────────
export async function sevSetRegStatusAction(id: string, status: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await me();
  if (!a.ok) return a;
  const r = await setRegStatus(id, status, a.user.id);
  return r.ok ? done("상태를 바꿨습니다.") : r;
}

export async function sevSetRegNoteAction(id: string, note: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await me();
  if (!a.ok) return a;
  const r = await setRegNote(id, note, a.user.id);
  return r.ok ? done("메모를 저장했습니다.") : r;
}

export async function sevSetRegOwnerAction(id: string, owner: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await me();
  if (!a.ok) return a;
  const r = await setRegOwner(id, owner || null, a.user.id);
  return r.ok ? done("담당을 지정했습니다.") : r;
}

/** 검수용 합성 신청 1건 추가. 실제 고객 데이터를 쓰지 않는다. */
export async function sevAddTestRegAction(eventId: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  const r = await addTestRegistration(eventId, a.user.id);
  return r.ok ? done("검수용 합성 신청 1건을 넣었습니다(TEST 표기).") : r;
}

export async function sevClearTestAction(eventId: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  try {
    const r = await deleteSevTestRegs(eventId);
    return done(`검수용 TEST 데이터 ${r.deleted}건을 지웠습니다(실제 신청은 그대로입니다).`);
  } catch (e) {
    return { ok: false, error: `삭제 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

// ── 외부 공유 ────────────────────────────────────────────────
export async function sevCreateShareAction(eventId: string, label: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await sharer();
  if (!a.ok) return a;
  const r = await createShare(eventId, label, a.user.id);
  return r.ok
    ? done("열람 링크를 발급했습니다 — 비밀번호를 설정하기 전에는 열리지 않습니다.")
    : r;
}

export async function sevSetSharePasswordAction(shareId: string, password: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await sharer();
  if (!a.ok) return a;
  const r = await setSharePassword(shareId, password, a.user.id);
  return r.ok ? done("비밀번호를 설정했습니다(기존 열람 세션은 모두 끊겼습니다).") : r;
}

export async function sevSetShareFieldsAction(shareId: string, fields: string[], allowDownload: boolean):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await sharer();
  if (!a.ok) return a;
  const r = await setShareFields(shareId, fields, allowDownload);
  return r.ok ? done("노출 항목을 저장했습니다.") : r;
}

export async function sevSetShareEnabledAction(shareId: string, enabled: boolean):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await sharer();
  if (!a.ok) return a;
  const r = await setShareEnabled(shareId, enabled, a.user.id);
  return r.ok ? done(enabled ? "외부 열람을 켰습니다." : "외부 열람을 껐습니다.") : r;
}

export async function sevSetShareExpiryAction(shareId: string, iso: string | null):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await sharer();
  if (!a.ok) return a;
  const r = await setShareExpiry(shareId, iso);
  return r.ok ? done("만료 일시를 저장했습니다.") : r;
}

export async function sevRotateShareAction(shareId: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await sharer();
  if (!a.ok) return a;
  const r = await rotateShareToken(shareId);
  return r.ok ? done("주소를 새로 발급했습니다 — 기존 링크는 더 열리지 않습니다.") : r;
}

export async function sevRevokeShareAction(shareId: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await sharer();
  if (!a.ok) return a;
  const r = await revokeShare(shareId);
  return r.ok ? done("링크를 철회했습니다.") : r;
}

export async function sevRevokeShareSessionsAction(shareId: string):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await sharer();
  if (!a.ok) return a;
  const r = await revokeShareSessions(shareId);
  return done(`열람 세션 ${r.revoked}건을 끊었습니다.`);
}
