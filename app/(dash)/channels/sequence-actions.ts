"use server";
// 유입 소스 키별 연속 안내(드립) 설정 — 저장·미리보기·수동 실행.
import { currentUser } from "@/lib/auth";
import {
  saveSeqConfig, saveSeqStep, listSeqSteps, listSeqQueue, runDueSequence, cancelLead,
  copySeqSteps, planSchedule, getSeqConfig,
  type SeqConfig, type SeqStep, type SeqQueueRow,
} from "@/lib/lead-sequence";

function canEdit(role: string | undefined): boolean { return role === "lead" || role === "exec"; }

export async function saveSeqConfigAction(c: SeqConfig): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  try { await saveSeqConfig(c, u.name || u.id); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function saveSeqStepAction(step: SeqStep): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  try { await saveSeqStep(step, u.name || u.id); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function listSeqStepsAction(channelId: string, days: number): Promise<{ ok: boolean; steps?: SeqStep[] }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  return { ok: true, steps: await listSeqSteps(channelId, days) };
}

export async function listSeqQueueAction(channelId?: string): Promise<{ ok: boolean; rows?: SeqQueueRow[] }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  return { ok: true, rows: await listSeqQueue(channelId) };
}

/** 이 설정으로 리드가 지금 들어오면 언제 나가는지 — 저장 전 확인용(발송 없음).
 *  일차별로 따로 지정한 시각까지 반영해 보여준다. */
export async function previewSeqScheduleAction(c: SeqConfig, hourByDay?: Record<number, number | null>):
  Promise<{ ok: boolean; slots?: { day_no: number; due_at: string }[] }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  const plan = planSchedule(new Date(), { ...c, hourByDay: hourByDay ?? {} });
  return { ok: true, slots: plan.map((p) => ({ day_no: p.day_no, due_at: p.due_at.toISOString() })) };
}

/** 다른 키의 문구를 통째로 복사. */
export async function copySeqStepsAction(fromKey: string, toKey: string): Promise<{ ok: boolean; copied?: number; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  if (!fromKey || fromKey === toKey) return { ok: false, error: "복사할 다른 키를 고르세요." };
  const n = await copySeqSteps(fromKey, toKey, u.name || u.id);
  // 기간도 원본에 맞춰 둬야 일차 수가 어긋나지 않는다.
  const from = await getSeqConfig(fromKey);
  const to = await getSeqConfig(toKey);
  if (from.days !== to.days) await saveSeqConfig({ ...to, days: from.days }, u.name || u.id).catch(() => {});
  return { ok: true, copied: n };
}

/** 예정분 지금 처리 — 크론을 기다리지 않고 확인할 때(전체 키 대상). */
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
