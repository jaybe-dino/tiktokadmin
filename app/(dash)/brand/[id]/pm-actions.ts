"use server";
// PM 에이전트 서버액션.
//   모든 액션이 같은 가드를 지난다: 브랜드 접근 확인 + 하위 레코드 소유 확인.
//   외부 발송·고객 연락은 하나도 하지 않는다.
import { revalidatePath } from "next/cache";
import { guard, brandAccess } from "@/lib/pm-access";
import {
  getPmConfig, setPmEnabled, setPmOwner, setPmNote,
  listPmKpis, createPmKpi, updatePmKpi, archivePmKpi, kpiReferences,
  listPmTasks, createPmTask, updatePmTask, setPmTaskStatus, confirmPmTask, listTaskEvents,
  addManualComm, deleteManualComm, runPmAnalysis, listPmRuns, pmSchemaState,
  type KpiInput, type TaskInput, type ManualCommInput,
} from "@/lib/pm-agent";
import { brandCommTimeline, type CommChannel } from "@/lib/pm-comms";

export interface PmResult { ok: boolean; error?: string; note?: string }

const fail = (error: string): PmResult => ({ ok: false, error });

function touch(brandId: string) {
  revalidatePath(`/brand/${brandId}`);
}

// ── 조회 ─────────────────────────────────────────────────────
export async function pmOverviewAction(brandId: string): Promise<{
  ok: boolean; error?: string;
  data?: {
    schema: Awaited<ReturnType<typeof pmSchemaState>>;
    config: Awaited<ReturnType<typeof getPmConfig>>;
    kpis: Awaited<ReturnType<typeof listPmKpis>>;
    refs: Awaited<ReturnType<typeof kpiReferences>>;
    openTasks: Awaited<ReturnType<typeof listPmTasks>>;
    doneTasks: Awaited<ReturnType<typeof listPmTasks>>;
    runs: Awaited<ReturnType<typeof listPmRuns>>;
    canAssignPm: boolean;
    isTest: boolean;
  };
}> {
  const a = await brandAccess(brandId);
  if (!a.ok) return { ok: false, error: a.error };
  const schema = await pmSchemaState();
  if (!schema.ready) {
    return { ok: false, error: `마이그레이션 0099_pm_agent.sql 미적용 — 없는 표: ${schema.missing.join(", ") || schema.error || "확인 실패"}` };
  }
  try {
    const [config, kpis, refs, openTasks, doneTasks, runs] = await Promise.all([
      getPmConfig(a.access.brandId),
      listPmKpis(a.access.brandId),
      kpiReferences(a.access.brandId),
      listPmTasks(a.access.brandId, { status: "open" }),
      listPmTasks(a.access.brandId, { status: "done" }),
      listPmRuns(a.access.brandId),
    ]);
    return {
      ok: true,
      data: { schema, config, kpis, refs, openTasks, doneTasks, runs, canAssignPm: a.access.canAssignPm, isTest: a.access.isTest },
    };
  } catch (e) {
    return { ok: false, error: `PM 정보를 불러오지 못했습니다 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function pmCommsAction(brandId: string, input: { q?: string; page?: number; pageSize?: number; channels?: string[] }):
  Promise<{ ok: boolean; error?: string; data?: Awaited<ReturnType<typeof brandCommTimeline>> }> {
  const a = await brandAccess(brandId);
  if (!a.ok) return { ok: false, error: a.error };
  try {
    const data = await brandCommTimeline(a.access.brandId, {
      q: input.q, page: input.page, pageSize: input.pageSize,
      channels: (input.channels ?? []).filter(Boolean) as CommChannel[],
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `대화 조회 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function pmTaskHistoryAction(brandId: string, taskId: string):
  Promise<{ ok: boolean; error?: string; events?: Awaited<ReturnType<typeof listTaskEvents>> }> {
  const g = await guard(brandId, { table: "pm_tasks", id: taskId });
  if (!g.ok) return { ok: false, error: g.error };
  try { return { ok: true, events: await listTaskEvents(taskId, g.access.brandId) }; }
  catch (e) { return { ok: false, error: `이력 조회 실패 — ${(e as Error).message.slice(0, 160)}` }; }
}

// ── 설정 ─────────────────────────────────────────────────────
export async function pmSetEnabledAction(brandId: string, enabled: boolean): Promise<PmResult> {
  const g = await guard(brandId);
  if (!g.ok) return fail(g.error);
  try { await setPmEnabled(g.access.brandId, enabled); touch(g.access.brandId); return { ok: true, note: enabled ? "PM 자동 운영 ON" : "PM 자동 운영 OFF" }; }
  catch (e) { return fail(`저장 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

export async function pmSetOwnerAction(brandId: string, ownerAdminId: string): Promise<PmResult> {
  const g = await guard(brandId);
  if (!g.ok) return fail(g.error);
  // PM 담당자 지정은 전체 권한(exec/lead) 또는 브랜드 배정 담당자만 — 권한 확장 방지.
  if (!g.access.canAssignPm) return fail("PM 담당자 지정은 파트장·대표 또는 브랜드 배정 담당자만 가능합니다.");
  const id = (ownerAdminId ?? "").trim().toLowerCase();
  try { await setPmOwner(g.access.brandId, id || null); touch(g.access.brandId); return { ok: true, note: id ? "PM 담당자 지정됨" : "PM 담당자 해제됨" }; }
  catch (e) { return fail(`저장 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

export async function pmSetNoteAction(brandId: string, note: string): Promise<PmResult> {
  const g = await guard(brandId);
  if (!g.ok) return fail(g.error);
  try { await setPmNote(g.access.brandId, note ?? ""); touch(g.access.brandId); return { ok: true, note: "메모 저장됨" }; }
  catch (e) { return fail(`저장 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

// ── KPI ──────────────────────────────────────────────────────
export async function pmCreateKpiAction(brandId: string, input: KpiInput): Promise<PmResult> {
  const g = await guard(brandId);
  if (!g.ok) return fail(g.error);
  if (!(input.name ?? "").trim()) return fail("KPI 이름을 입력하세요.");
  try { await createPmKpi(g.access.brandId, input, g.access.user.id); touch(g.access.brandId); return { ok: true, note: "KPI 추가됨" }; }
  catch (e) { return fail(`저장 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

export async function pmUpdateKpiAction(brandId: string, kpiId: string, input: KpiInput): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_kpis", id: kpiId });
  if (!g.ok) return fail(g.error);
  if (!(input.name ?? "").trim()) return fail("KPI 이름을 입력하세요.");
  try { await updatePmKpi(kpiId, g.access.brandId, input); touch(g.access.brandId); return { ok: true, note: "KPI 저장됨" }; }
  catch (e) { return fail(`저장 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

export async function pmArchiveKpiAction(brandId: string, kpiId: string): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_kpis", id: kpiId });
  if (!g.ok) return fail(g.error);
  try { await archivePmKpi(kpiId, g.access.brandId); touch(g.access.brandId); return { ok: true, note: "KPI 보관됨" }; }
  catch (e) { return fail(`처리 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

// ── 업무 ─────────────────────────────────────────────────────
export async function pmCreateTaskAction(brandId: string, input: TaskInput): Promise<PmResult> {
  const g = await guard(brandId);
  if (!g.ok) return fail(g.error);
  if (!(input.title ?? "").trim()) return fail("제목을 입력하세요.");
  try { await createPmTask(g.access.brandId, input, g.access.user.id); touch(g.access.brandId); return { ok: true, note: "등록됨" }; }
  catch (e) { return fail(`저장 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

export async function pmUpdateTaskAction(brandId: string, taskId: string, input: TaskInput): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_tasks", id: taskId });
  if (!g.ok) return fail(g.error);
  if (!(input.title ?? "").trim()) return fail("제목을 입력하세요.");
  try { await updatePmTask(taskId, g.access.brandId, input, g.access.user.id); touch(g.access.brandId); return { ok: true, note: "저장됨" }; }
  catch (e) { return fail(`저장 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

export async function pmSetTaskStatusAction(brandId: string, taskId: string, status: string): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_tasks", id: taskId });
  if (!g.ok) return fail(g.error);
  try {
    await setPmTaskStatus(taskId, g.access.brandId, status, g.access.user.id);
    touch(g.access.brandId);
    return { ok: true, note: status === "done" ? "완료 처리됨" : status === "reopened" ? "다시 열림" : "상태 변경됨" };
  } catch (e) { return fail(`처리 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

export async function pmConfirmTaskAction(brandId: string, taskId: string): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_tasks", id: taskId });
  if (!g.ok) return fail(g.error);
  try { await confirmPmTask(taskId, g.access.brandId, g.access.user.id); touch(g.access.brandId); return { ok: true, note: "사람이 확정한 업무로 표시됨" }; }
  catch (e) { return fail(`처리 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

// ── 수동 대화 등록 ────────────────────────────────────────────
export async function pmAddCommAction(brandId: string, input: ManualCommInput): Promise<PmResult> {
  const g = await guard(brandId);
  if (!g.ok) return fail(g.error);
  try { await addManualComm(g.access.brandId, input, g.access.user.id); touch(g.access.brandId); return { ok: true, note: "원문 등록됨" }; }
  catch (e) { return fail(`${(e as Error).message.slice(0, 160)}`); }
}

export async function pmDeleteCommAction(brandId: string, commId: string): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_manual_comms", id: commId });
  if (!g.ok) return fail(g.error);
  try { await deleteManualComm(commId, g.access.brandId); touch(g.access.brandId); return { ok: true, note: "삭제됨" }; }
  catch (e) { return fail(`삭제 실패 — ${(e as Error).message.slice(0, 160)}`); }
}

// ── 분석 실행 ─────────────────────────────────────────────────
export async function pmRunAction(brandId: string, useAi: boolean): Promise<PmResult & { mode?: string; created?: number; skipped?: number; aiNote?: string }> {
  const g = await guard(brandId);
  if (!g.ok) return fail(g.error);
  const r = await runPmAnalysis(g.access.brandId, { triggeredBy: "manual", useAi });
  touch(g.access.brandId);
  return {
    ok: r.ok, error: r.error,
    note: r.ok ? r.summary : undefined,
    mode: r.mode, created: r.created, skipped: r.skipped, aiNote: r.aiNote,
  };
}

// ── 운영 검수용 합성 데이터(대표 전용) ─────────────────────────
//   실제 고객 브랜드를 만들거나 수정하지 않는다. is_test=true·연락처 없음 브랜드만 만든다.
export async function pmQaFixtureAction(): Promise<PmResult & { brandId?: string; brandName?: string }> {
  const { currentUser } = await import("@/lib/auth");
  const u = await currentUser();
  if (!u) return fail("세션 만료");
  if (u.role !== "exec") return fail("권한 없음 — 대표(exec)만 실행할 수 있습니다.");
  const schema = await pmSchemaState();
  if (!schema.ready) return fail(`마이그레이션 0099_pm_agent.sql 미적용 — 없는 표: ${schema.missing.join(", ") || schema.error || "확인 실패"}`);
  try {
    const { ensurePmQaFixture } = await import("@/lib/pm-qa");
    const r = await ensurePmQaFixture(u.id);
    revalidatePath(`/brand/${r.brandId}`);
    return { ok: true, note: r.note, brandId: r.brandId, brandName: r.brandName };
  } catch (e) {
    return fail(`검수 데이터 생성 실패 — ${(e as Error).message.slice(0, 200)}`);
  }
}
