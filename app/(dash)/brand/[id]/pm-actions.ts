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

// ═══════════════════════════════════════════════════════════
// PM 1차 확장 — KPI 분류/확정 · 계약 조건 · 대화 추출 · 업무 연결 · 상단 요약 · 히스토리 질의
//   모든 액션이 위와 같은 brandAccess 가드를 지나고, 가드가 돌려준 brandId 로만 조회한다.
//   이 파일에는 브랜드사(고객)에게 보내는 경로가 없다.
// ═══════════════════════════════════════════════════════════

export interface PmV2Overview {
  schemaReady: boolean;
  schemaError?: string;
  migration: string;
  terms: Awaited<ReturnType<typeof import("@/lib/pm-v2").listContractTerms>>;
  extractions: Awaited<ReturnType<typeof import("@/lib/pm-v2").listExtractions>>;
  kpis: Awaited<ReturnType<typeof import("@/lib/pm-v2").listKpisForBrief>>;
  tasks: Awaited<ReturnType<typeof import("@/lib/pm-v2").listTasksForBrief>>;
  taskDetail: Awaited<ReturnType<typeof import("@/lib/pm-v2").listTaskResults>>;
  summary: Awaited<ReturnType<typeof import("@/lib/pm-v2").pmHeaderSummary>>;
  notify: Awaited<ReturnType<typeof import("@/lib/pm-notify").getPmNotifyConfig>> | null;
  notifyLog: Awaited<ReturnType<typeof import("@/lib/pm-notify").listPmNotifyLog>>;
  canWrite: boolean;
}

export async function pmV2OverviewAction(brandId: string): Promise<{ ok: boolean; error?: string; data?: PmV2Overview }> {
  const a = await brandAccess(brandId);
  if (!a.ok) return { ok: false, error: a.error };
  const v2 = await import("@/lib/pm-v2");
  const schema = await v2.pmV2Schema();
  if (!schema.ready) {
    return {
      ok: true,
      data: {
        schemaReady: false,
        schemaError: `마이그레이션 ${v2.PM_V2_MIGRATION} 미적용 — 없는 항목: ${schema.missing.slice(0, 6).join(", ") || schema.error || "확인 실패"}`,
        migration: v2.PM_V2_MIGRATION,
        terms: [], extractions: [], kpis: [], tasks: [], taskDetail: [],
        summary: await v2.pmHeaderSummary(a.access.brandId),
        notify: null, notifyLog: [], canWrite: a.access.canEdit,
      },
    };
  }
  try {
    const notifyMod = await import("@/lib/pm-notify");
    const [terms, extractions, kpis, tasks, taskDetail, summary, notify, notifyLog] = await Promise.all([
      v2.listContractTerms(a.access.brandId),
      v2.listExtractions(a.access.brandId, { status: "all" }),
      v2.listKpisForBrief(a.access.brandId),
      v2.listTasksForBrief(a.access.brandId),
      v2.listTaskResults(a.access.brandId),
      v2.pmHeaderSummary(a.access.brandId),
      notifyMod.getPmNotifyConfig().catch(() => null),
      notifyMod.listPmNotifyLog(20).catch(() => []),
    ]);
    return {
      ok: true,
      data: {
        schemaReady: true, migration: v2.PM_V2_MIGRATION,
        terms, extractions, kpis, tasks, taskDetail, summary, notify, notifyLog, canWrite: a.access.canEdit,
      },
    };
  } catch (e) {
    return { ok: false, error: `PM 확장 정보를 불러오지 못했습니다 — ${(e as Error).message.slice(0, 200)}` };
  }
}

// ── KPI 분류·확정·이력 ──────────────────────────────────────
export async function pmSetKpiClassAction(brandId: string, kpiId: string,
  patch: import("@/lib/pm-v2").KpiClassPatch): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_kpis", id: kpiId });
  if (!g.ok) return fail(g.error);
  const { setKpiClass } = await import("@/lib/pm-v2");
  const r = await setKpiClass(kpiId, g.access.brandId, patch, g.access.user.id);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "저장했습니다." } : fail(r.error ?? "저장 실패");
}

export async function pmConfirmKpiAction(brandId: string, kpiId: string): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_kpis", id: kpiId });
  if (!g.ok) return fail(g.error);
  const { confirmKpi } = await import("@/lib/pm-v2");
  const r = await confirmKpi(kpiId, g.access.brandId, g.access.user.id);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "담당 확인으로 합의 처리했습니다." } : fail(r.error ?? "확정 실패");
}

export async function pmKpiEventsAction(brandId: string, kpiId: string):
  Promise<{ ok: boolean; error?: string; events?: Awaited<ReturnType<typeof import("@/lib/pm-v2").listKpiEvents>> }> {
  const g = await guard(brandId, { table: "pm_kpis", id: kpiId });
  if (!g.ok) return { ok: false, error: g.error };
  const { listKpiEvents } = await import("@/lib/pm-v2");
  return { ok: true, events: await listKpiEvents(kpiId, g.access.brandId) };
}

// ── 계약 조건 ───────────────────────────────────────────────
export async function pmCreateTermAction(brandId: string, input: import("@/lib/pm-v2").TermInput): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  try {
    const { createContractTerm } = await import("@/lib/pm-v2");
    await createContractTerm(a.access.brandId, input, a.access.user.id);
    touch(brandId);
    return { ok: true, note: "계약 조건을 추가했습니다." };
  } catch (e) {
    return fail((e as Error).message.slice(0, 200));
  }
}

export async function pmUpdateTermAction(brandId: string, termId: string, input: import("@/lib/pm-v2").TermInput): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  const { updateContractTerm } = await import("@/lib/pm-v2");
  const r = await updateContractTerm(termId, a.access.brandId, input);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "저장했습니다." } : fail(r.error ?? "저장 실패");
}

export async function pmConfirmTermAction(brandId: string, termId: string): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  const { confirmContractTerm } = await import("@/lib/pm-v2");
  const r = await confirmContractTerm(termId, a.access.brandId, a.access.user.id);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "계약 조건을 확정했습니다." } : fail(r.error ?? "확정 실패");
}

export async function pmDeleteTermAction(brandId: string, termId: string): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  const { deleteContractTerm } = await import("@/lib/pm-v2");
  const r = await deleteContractTerm(termId, a.access.brandId);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "삭제했습니다." } : fail(r.error ?? "삭제 실패");
}

// ── 대화 추출 ───────────────────────────────────────────────
export async function pmRunExtractionAction(brandId: string): Promise<PmResult & { mode?: string; created?: number }> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  const v2 = await import("@/lib/pm-v2");
  const schema = await v2.pmV2Schema();
  if (!schema.ready) return fail(`마이그레이션 ${v2.PM_V2_MIGRATION} 미적용 — 없는 항목: ${schema.missing.slice(0, 4).join(", ")}`);
  try {
    const { runPmExtraction } = await import("@/lib/pm-extract-run");
    const r = await runPmExtraction({ brandId: a.access.brandId, brandName: a.access.brandName, actor: a.access.user.id });
    touch(brandId);
    const caveat = r.caveats.length ? `\n수집 범위: ${r.caveats.join(" · ")}` : "";
    return r.ok
      ? { ok: true, note: `${r.note}${caveat}`, mode: r.mode, created: r.created }
      : { ok: false, error: `${r.note}${caveat}` };
  } catch (e) {
    return fail(`추출 실패 — ${(e as Error).message.slice(0, 200)}`);
  }
}

export async function pmRecheckContractsAction(brandId: string): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  try {
    const { recheckContracts } = await import("@/lib/pm-v2");
    const r = await recheckContracts(a.access.brandId);
    touch(brandId);
    return { ok: true, note: `계약 대조를 다시 계산했습니다 — ${r.updated}건 중 대조 불가 ${r.unknown}건(사람이 고친 항목은 그대로 둡니다).` };
  } catch (e) {
    return fail(`대조 실패 — ${(e as Error).message.slice(0, 200)}`);
  }
}

export async function pmAddExtractionAction(brandId: string, input: import("@/lib/pm-v2").ExtractionInput): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  try {
    const { upsertExtraction } = await import("@/lib/pm-v2");
    const r = await upsertExtraction(a.access.brandId, { ...input, origin: "human", dedupeKey: null }, a.access.user.id);
    if (!r.id) return fail("제목을 입력하세요.");
    touch(brandId);
    return { ok: true, note: "등록했습니다." };
  } catch (e) {
    return fail((e as Error).message.slice(0, 200));
  }
}

export async function pmEditExtractionAction(brandId: string, extractionId: string,
  patch: { replyDraft?: string; internalChecks?: string; contractNote?: string; contractCheck?: string }): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  const { editExtraction } = await import("@/lib/pm-v2");
  const r = await editExtraction(extractionId, a.access.brandId, patch);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "저장했습니다 — 이후 자동 실행이 덮어쓰지 않습니다." } : fail(r.error ?? "저장 실패");
}

export async function pmSetExtractionStatusAction(brandId: string, extractionId: string, status: string): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  const { setExtractionStatus } = await import("@/lib/pm-v2");
  const r = await setExtractionStatus(extractionId, a.access.brandId, status, a.access.user.id);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "처리했습니다." } : fail(r.error ?? "처리 실패");
}

export async function pmTaskFromExtractionAction(brandId: string, extractionId: string,
  opts: { owner?: string | null; dueDate?: string | null; kpiId?: string | null; waitingOn?: string }): Promise<PmResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return fail(a.error);
  const { taskFromExtraction } = await import("@/lib/pm-v2");
  const r = await taskFromExtraction(extractionId, a.access.brandId, opts, a.access.user.id);
  if (r.ok) touch(brandId);
  return r.ok
    ? { ok: true, note: r.already ? "이미 이 항목으로 만든 업무가 있습니다 — 중복 생성하지 않았습니다." : "담당 업무를 만들었습니다." }
    : fail(r.error ?? "생성 실패");
}

// ── 업무 확장 ───────────────────────────────────────────────
export async function pmSetTaskWaitingAction(brandId: string, taskId: string, waitingOn: string): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_tasks", id: taskId });
  if (!g.ok) return fail(g.error);
  const { setTaskWaiting } = await import("@/lib/pm-v2");
  const r = await setTaskWaiting(taskId, g.access.brandId, waitingOn, g.access.user.id);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "저장했습니다." } : fail(r.error ?? "저장 실패");
}

export async function pmSetTaskKpiAction(brandId: string, taskId: string, kpiId: string | null): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_tasks", id: taskId });
  if (!g.ok) return fail(g.error);
  const { setTaskKpi } = await import("@/lib/pm-v2");
  const r = await setTaskKpi(taskId, g.access.brandId, kpiId, g.access.user.id);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: "저장했습니다." } : fail(r.error ?? "저장 실패");
}

export async function pmSetTaskResultAction(brandId: string, taskId: string,
  input: { resultNote?: string; resultEvidence?: string; complete?: boolean }): Promise<PmResult> {
  const g = await guard(brandId, { table: "pm_tasks", id: taskId });
  if (!g.ok) return fail(g.error);
  const { setTaskResult } = await import("@/lib/pm-v2");
  const r = await setTaskResult(taskId, g.access.brandId, input, g.access.user.id);
  if (r.ok) touch(brandId);
  return r.ok ? { ok: true, note: input.complete ? "완료 근거와 함께 완료 처리했습니다." : "실행결과를 저장했습니다." } : fail(r.error ?? "저장 실패");
}

// ── 내부 알림 ───────────────────────────────────────────────
export async function pmSaveNotifyAction(patch: import("@/lib/pm-notify").NotifyPatch): Promise<PmResult> {
  const { currentUser } = await import("@/lib/auth");
  const u = await currentUser();
  if (!u) return fail("권한이 없습니다.");
  if (u.role !== "exec" && u.role !== "lead") return fail("알림 설정은 대표·파트장만 바꿀 수 있습니다.");
  const { updatePmNotifyConfig } = await import("@/lib/pm-notify");
  const r = await updatePmNotifyConfig(patch, u.id);
  return r.ok ? { ok: true, note: "저장했습니다." } : fail(r.error ?? "저장 실패");
}

/** 내부 안내 미리보기 — 실제 전송 없이 누구에게 무엇이 갈지 확인한다. */
export async function pmPreviewNotifyAction(kind: "urgent" | "daily" | "weekly"):
  Promise<{ ok: boolean; error?: string; note?: string }> {
  const { currentUser } = await import("@/lib/auth");
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const { runPmNotify } = await import("@/lib/pm-notify");
  const r = await runPmNotify(kind, { dryRun: true });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    note: `수신자 ${r.recipients} · 보낼 내용 있는 사람 ${r.skipped + r.sent} · 중복 ${r.duplicate}`
      + (r.blocked.length ? ` · 발송 안 함: ${r.blocked.join(" · ")}` : " · 미리보기라 실제 발송하지 않았습니다"),
  };
}

// ── 히스토리 질의응답 ───────────────────────────────────────
export async function pmAskHistoryAction(brandId: string, question: string):
  Promise<{ ok: boolean; error?: string; answer?: string; mode?: string }> {
  const a = await brandAccess(brandId);
  if (!a.ok) return { ok: false, error: a.error };
  try {
    const { answerBrandHistory } = await import("@/lib/pm-history");
    const r = await answerBrandHistory({ brandId: a.access.brandId, brandName: a.access.brandName, question });
    return r.ok ? { ok: true, answer: r.text, mode: r.mode } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: `질의 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}
