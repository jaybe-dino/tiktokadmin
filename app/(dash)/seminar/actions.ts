"use server";
// 세미나 안내 자동발송 — 어드민 서버액션.
//   설정·문구 변경은 exec/lead 만. 조회는 로그인한 담당자면 가능.
//   이 파일에서 직접 고객에게 보내는 경로는 "지금 발송"(수동 트리거) 하나뿐이고,
//   그 경로도 마스터 스위치·Zoom 링크·문구 활성 검사를 그대로 지난다.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import {
  seminarSchemaState, getSeminarConfig, updateSeminarConfig, listSeminarTemplates,
  updateSeminarTemplate, buildSessionTargets, previewSession, dispatchDue,
  listSessions, listSessionSends, listSessionTargets, listRuns, upcomingSessionDate,
  SEMINAR_SCHEMA_MIGRATION,
  type ConfigPatch, type TemplatePatch, type PreviewResult, type BuildResult, type DispatchResult,
} from "@/lib/seminar";
import type { SeminarStage } from "@/lib/seminar-schedule";

const WRITE_ROLES = new Set(["exec", "lead"]);

async function reader() {
  const u = await currentUser();
  if (!u) return { ok: false as const, error: "권한이 없습니다." };
  return { ok: true as const, user: u };
}
async function writer() {
  const u = await currentUser();
  if (!u) return { ok: false as const, error: "권한이 없습니다." };
  if (!WRITE_ROLES.has(u.role)) return { ok: false as const, error: "설정 변경은 대표·파트장만 가능합니다." };
  return { ok: true as const, user: u };
}
const touch = () => revalidatePath("/seminar");

export interface SeminarOverview {
  schemaReady: boolean;
  schemaError?: string;
  migration: string;
  config: Awaited<ReturnType<typeof getSeminarConfig>> | null;
  templates: Awaited<ReturnType<typeof listSeminarTemplates>>;
  sessions: Awaited<ReturnType<typeof listSessions>>;
  runs: Awaited<ReturnType<typeof listRuns>>;
  upcoming: string;
  canWrite: boolean;
}

export async function seminarOverviewAction(): Promise<{ ok: boolean; error?: string; data?: SeminarOverview }> {
  const a = await reader();
  if (!a.ok) return a;
  const schema = await seminarSchemaState();
  if (!schema.ready) {
    return {
      ok: true,
      data: {
        schemaReady: false,
        schemaError: `마이그레이션 ${SEMINAR_SCHEMA_MIGRATION} 미적용 — 없는 표: ${schema.missing.join(", ") || schema.error || "확인 실패"}`,
        migration: SEMINAR_SCHEMA_MIGRATION,
        config: null, templates: [], sessions: [], runs: [], upcoming: "",
        canWrite: WRITE_ROLES.has(a.user.role),
      },
    };
  }
  try {
    const config = await getSeminarConfig();
    const [templates, sessions, runs] = await Promise.all([
      listSeminarTemplates(), listSessions(), listRuns(),
    ]);
    return {
      ok: true,
      data: {
        schemaReady: true, migration: SEMINAR_SCHEMA_MIGRATION,
        config, templates, sessions, runs,
        upcoming: upcomingSessionDate(config),
        canWrite: WRITE_ROLES.has(a.user.role),
      },
    };
  } catch (e) {
    return { ok: false, error: `세미나 설정을 불러오지 못했습니다 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function seminarSaveConfigAction(patch: ConfigPatch): Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await writer();
  if (!a.ok) return a;
  try {
    const r = await updateSeminarConfig(patch, a.user.id);
    if (r.ok) touch();
    return r.ok ? { ok: true, note: "저장했습니다." } : r;
  } catch (e) {
    return { ok: false, error: `저장 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function seminarSaveTemplateAction(stage: string, patch: TemplatePatch):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const a = await writer();
  if (!a.ok) return a;
  if (stage !== "notice" && stage !== "followup") return { ok: false, error: "알 수 없는 단계입니다." };
  try {
    const r = await updateSeminarTemplate(stage as SeminarStage, patch, a.user.id);
    if (r.ok) touch();
    return r.ok ? { ok: true, note: "저장했습니다." } : r;
  } catch (e) {
    return { ok: false, error: `저장 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function seminarPreviewAction(sessionDate?: string):
  Promise<{ ok: boolean; error?: string; data?: PreviewResult }> {
  const a = await reader();
  if (!a.ok) return a;
  try {
    const cfg = await getSeminarConfig();
    const day = (sessionDate ?? "").trim() || upcomingSessionDate(cfg);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "회차 날짜 형식이 올바르지 않습니다(YYYY-MM-DD)." };
    return { ok: true, data: await previewSession(day) };
  } catch (e) {
    return { ok: false, error: `미리보기 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function seminarBuildAction(sessionDate?: string): Promise<BuildResult> {
  const a = await writer();
  if (!a.ok) return { ok: false, error: a.error };
  try {
    const cfg = await getSeminarConfig();
    const day = (sessionDate ?? "").trim() || upcomingSessionDate(cfg);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "회차 날짜 형식이 올바르지 않습니다(YYYY-MM-DD)." };
    const r = await buildSessionTargets(day, a.user.id);
    if (r.ok) touch();
    return r;
  } catch (e) {
    return { ok: false, error: `대상 확정 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}

/** 예정 시각이 지난 예약을 지금 처리한다. 마스터 스위치가 꺼져 있으면 아무것도 보내지 않는다. */
export async function seminarDispatchAction(): Promise<DispatchResult> {
  const a = await writer();
  if (!a.ok) return { ok: false, error: a.error, due: 0, sent: 0, failed: 0, skipped: 0, retry: 0 };
  try {
    const r = await dispatchDue(200, new Date(), `manual:${a.user.id}`);
    touch();
    return r;
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200), due: 0, sent: 0, failed: 0, skipped: 0, retry: 0 };
  }
}

export async function seminarSessionDetailAction(sessionId: string): Promise<{
  ok: boolean; error?: string;
  data?: { targets: Awaited<ReturnType<typeof listSessionTargets>>; sends: Awaited<ReturnType<typeof listSessionSends>> };
}> {
  const a = await reader();
  if (!a.ok) return a;
  try {
    const [targets, sends] = await Promise.all([listSessionTargets(sessionId), listSessionSends(sessionId)]);
    return { ok: true, data: { targets, sends } };
  } catch (e) {
    return { ok: false, error: `회차 내역을 불러오지 못했습니다 — ${(e as Error).message.slice(0, 200)}` };
  }
}
