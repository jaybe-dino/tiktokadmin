"use server";
// 「브랜드 해외매출 실행전략 세미나」 신청 관리(관리자).
//
//   일부러 하지 않는 것
//     · 고객에게 메일·문자를 보내지 않는다. 선정 안내·Zoom 안내는 초안 생성까지만 한다.
//     · 선착순 자동선정·자동마감을 만들지 않는다 — 선정은 사람이 한 건씩 누른다.
//     · 브랜드 원장(brands)의 값을 고치지 않는다. 연결은 이 표의 brand_id 만 채운다.
//     · ad_optouts(수신거부 명단)를 고치지 않는다.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import {
  sapSchemaState, getSapConfig, listAdminSessions, setSessionZoom, setSessionActive, setSessionCap,
  listRegistrations, listRegEvents, setRegStatus, setRegNote, withdrawAdsConsent,
  linkBrand, matchCandidates, expiryState, addTestRegistration, deleteTestRegistrations,
  SAP_MIGRATION,
  type SapConfig, type AdminSession, type RegList, type RegEventRow, type RegRow,
  type MatchCandidate, type ExpiryState, type SelectResult,
} from "@/lib/seminar-apply";
import { ADMIN_PATH, APPLY_PATH } from "@/lib/seminar-apply-model";
import { csvOfRegs } from "@/lib/seminar-apply-admin-model";

const EDIT_ROLES = new Set(["exec", "lead"]);
/** Zoom 링크 입력·열람은 대표만. 공개 경로에는 어떤 경우에도 내보내지 않는다. */
const ZOOM_ROLES = new Set(["exec"]);

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
async function zoomer() {
  const a = await me();
  if (!a.ok) return a;
  if (!ZOOM_ROLES.has(a.user.role)) return { ok: false as const, error: "접속 링크는 대표만 다룰 수 있습니다." };
  return a;
}
const actorOf = (u: { name?: string | null; id: string }) => (u.name ?? "").trim() || u.id;
const done = () => { revalidatePath(ADMIN_PATH); };

// ── 개요 ─────────────────────────────────────────────────────
export interface SapOverview {
  schemaReady: boolean; schemaError?: string; migration: string;
  applyUrl: string;
  config?: SapConfig;
  sessions: AdminSession[];
  expiry?: ExpiryState;
  canEdit: boolean; canZoom: boolean;
}
export async function sapOverviewAction(): Promise<{ ok: boolean; error?: string; data?: SapOverview }> {
  const a = await me();
  if (!a.ok) return a;
  const canEdit = EDIT_ROLES.has(a.user.role);
  const canZoom = ZOOM_ROLES.has(a.user.role);
  const schema = await sapSchemaState();
  if (!schema.ready) {
    return {
      ok: true,
      data: {
        schemaReady: false,
        schemaError: `마이그레이션 ${SAP_MIGRATION} 미적용 — 없는 표: ${schema.missing.join(", ") || schema.error || "확인 실패"}`,
        migration: SAP_MIGRATION, applyUrl: APPLY_PATH, sessions: [], canEdit, canZoom,
      },
    };
  }
  try {
    const [config, sessions, expiry] = await Promise.all([getSapConfig(), listAdminSessions(), expiryState()]);
    // 권한이 없으면 링크 값을 아예 돌려주지 않는다(화면에 실어 보내지 않는다).
    const safe = sessions.map((s) => canZoom ? s : { ...s, zoom_url: s.zoom_url ? "(설정됨)" : "", zoom_note: "" });
    return {
      ok: true,
      data: { schemaReady: true, migration: SAP_MIGRATION, applyUrl: APPLY_PATH, config, sessions: safe, expiry, canEdit, canZoom },
    };
  } catch (e) {
    return { ok: false, error: `불러오지 못했습니다 — ${(e as Error).message.slice(0, 160)}` };
  }
}

// ── 신청자 목록 ──────────────────────────────────────────────
export async function sapListAction(
  opts: { sessionNo?: number; status?: string; q?: string; consult?: boolean; page?: number } = {},
): Promise<{ ok: boolean; error?: string; data?: RegList }> {
  const a = await me();
  if (!a.ok) return a;
  try {
    return { ok: true, data: await listRegistrations(opts) };
  } catch (e) {
    return { ok: false, error: `조회 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

export async function sapEventsAction(regId: string): Promise<{ ok: boolean; error?: string; rows?: RegEventRow[] }> {
  const a = await me();
  if (!a.ok) return a;
  try { return { ok: true, rows: await listRegEvents(regId) }; }
  catch (e) { return { ok: false, error: (e as Error).message.slice(0, 160) }; }
}

// ── 상태 변경(선정 상한은 서버 트랜잭션에서 강제) ────────────
export async function sapSetStatusAction(regId: string, next: string, reason: string): Promise<SelectResult> {
  const a = await editor();
  if (!a.ok) return { ok: false, error: a.error };
  const r = await setRegStatus(regId, next, reason, actorOf(a.user));
  if (r.ok) done();
  return r;
}

export async function sapSetNoteAction(regId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  try { await setRegNote(regId, note, actorOf(a.user)); done(); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message.slice(0, 160) }; }
}

export async function sapWithdrawAdsAction(regId: string): Promise<{ ok: boolean; error?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  const r = await withdrawAdsConsent(regId, actorOf(a.user));
  if (r.ok) done();
  return r;
}

// ── 회차 설정 ────────────────────────────────────────────────
export async function sapSetZoomAction(sessionId: string, url: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const a = await zoomer();
  if (!a.ok) return a;
  const r = await setSessionZoom(sessionId, url, note, actorOf(a.user));
  if (r.ok) done();
  return r;
}
export async function sapSetActiveAction(sessionId: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  try { await setSessionActive(sessionId, active); done(); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message.slice(0, 160) }; }
}
export async function sapSetCapAction(sessionId: string, cap: number): Promise<{ ok: boolean; error?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  const r = await setSessionCap(sessionId, cap);
  if (r.ok) done();
  return r;
}

// ── 원장 연결(비파괴적) ──────────────────────────────────────
export async function sapCandidatesAction(regId: string): Promise<{ ok: boolean; error?: string; rows?: MatchCandidate[] }> {
  const a = await me();
  if (!a.ok) return a;
  try { return { ok: true, rows: await matchCandidates(regId) }; }
  catch (e) { return { ok: false, error: (e as Error).message.slice(0, 160) }; }
}
export async function sapLinkBrandAction(regId: string, brandId: string): Promise<{ ok: boolean; error?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  const r = await linkBrand(regId, brandId, actorOf(a.user));
  if (r.ok) done();
  return r;
}

// ── CSV ──────────────────────────────────────────────────────
/**
 * 내려받기용 CSV. 기본값에는 접속 링크를 넣지 않는다.
 *   연락처는 "조회 권한"이 있는 역할에만 원문으로 주고, 그 외에는 가려서 준다.
 */
export async function sapCsvAction(
  opts: { sessionNo?: number; status?: string; q?: string; consult?: boolean } = {},
): Promise<{ ok: boolean; error?: string; csv?: string; filename?: string; masked?: boolean }> {
  const a = await me();
  if (!a.ok) return a;
  try {
    const all: RegRow[] = [];
    for (let page = 1; page <= 40; page++) {
      const r = await listRegistrations({ ...opts, page, pageSize: 200 });
      all.push(...r.rows);
      if (page >= r.pages) break;
    }
    const masked = !EDIT_ROLES.has(a.user.role);
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      ok: true, masked,
      csv: csvOfRegs(all, { masked }),
      filename: `세미나신청_${opts.sessionNo ? `${opts.sessionNo}회차_` : ""}${stamp}.csv`,
    };
  } catch (e) {
    return { ok: false, error: `내려받기 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

// ── 검수 ─────────────────────────────────────────────────────
export async function sapAddTestAction(sessionNo: number): Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  const r = await addTestRegistration(sessionNo, actorOf(a.user));
  if (r.ok) done();
  return r.ok ? { ok: true, note: "검수용 합성 신청을 넣었습니다(테스트 표시)." } : { ok: false, error: r.error };
}
export async function sapDeleteTestAction(): Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await editor();
  if (!a.ok) return a;
  try {
    const n = await deleteTestRegistrations();
    done();
    return { ok: true, note: `합성 신청 ${n}건을 지웠습니다(실제 신청은 그대로입니다).` };
  } catch (e) { return { ok: false, error: (e as Error).message.slice(0, 160) }; }
}

// ── 안내문 초안(발송하지 않는다) ─────────────────────────────
export async function sapDraftAction(regId: string, kind: "selected" | "zoom"):
  Promise<{ ok: boolean; error?: string; subject?: string; body?: string; note?: string }> {
  const a = await me();
  if (!a.ok) return a;
  try {
    const list = await listRegistrations({ page: 1, pageSize: 200 });
    const r = list.rows.find((x) => x.id === regId);
    if (!r) return { ok: false, error: "신청을 찾지 못했습니다." };
    const { draftSelectedMail, draftZoomMail } = await import("@/lib/seminar-apply-admin-model");
    // Zoom 초안에도 링크 원문을 넣지 않는다 — 보내기 전에 담당자가 직접 채운다.
    const d = kind === "selected" ? draftSelectedMail(r) : draftZoomMail(r);
    return { ok: true, ...d, note: "초안만 만들었습니다 — 발송하지 않았습니다." };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 160) };
  }
}
