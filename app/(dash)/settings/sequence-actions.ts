"use server";
// 신규 리드 연속 안내(드립) 설정 — 저장·미리보기·수동 실행. (app/actions.ts 는 수정 금지 → 별도 파일)
import { currentUser } from "@/lib/auth";
import {
  saveSeqSchedule, saveSeqStep, listSeqSteps, listSeqQueue, runDueSequence, cancelLead,
  planSchedule, getSeqSchedule, type SeqSchedule, type SeqStep, type SeqQueueRow,
} from "@/lib/lead-sequence";

function canEdit(role: string | undefined): boolean { return role === "lead" || role === "exec"; }

export async function saveSeqScheduleAction(s: Partial<SeqSchedule>): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  try { await saveSeqSchedule(s); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function saveSeqStepAction(step: SeqStep): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  try { await saveSeqStep(step, u.name || u.id); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function listSeqStepsAction(days: number): Promise<{ ok: boolean; steps?: SeqStep[] }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  return { ok: true, steps: await listSeqSteps(days) };
}

export async function listSeqQueueAction(): Promise<{ ok: boolean; rows?: SeqQueueRow[] }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  return { ok: true, rows: await listSeqQueue() };
}

/** 지금 설정으로 리드가 들어오면 언제 나가는지 — 저장 전 확인용(발송 없음). */
export async function previewSeqScheduleAction(s: Partial<SeqSchedule>): Promise<{ ok: boolean; slots?: { day_no: number; due_at: string }[] }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  const cur = await getSeqSchedule();
  const plan = planSchedule(new Date(), { ...cur, ...s });
  return { ok: true, slots: plan.map((p) => ({ day_no: p.day_no, due_at: p.due_at.toISOString() })) };
}

/** 예정분 지금 처리 — 크론을 기다리지 않고 확인할 때. */
export async function runSeqNowAction(): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  const r = await runDueSequence();
  return { ok: true, summary: `대상 ${r.due}건 · 발송 ${r.sent} · 건너뜀 ${r.skipped} · 실패 ${r.failed} · 중단 ${r.canceled}` };
}

/** 특정 브랜드의 남은 예약 중단(수신거부 요청 등). */
export async function cancelSeqAction(brandId: string, note: string): Promise<{ ok: boolean; canceled?: number; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  const n = await cancelLead(brandId, note || "수동 중단");
  return { ok: true, canceled: n };
}
