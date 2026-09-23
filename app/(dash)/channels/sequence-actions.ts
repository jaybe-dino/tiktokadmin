"use server";
// 유입 소스 키별 연속 안내(드립) 설정 — 저장·미리보기·수동 실행.
import { currentUser } from "@/lib/auth";
import {
  saveSeqConfig, saveSeqStep, listSeqSteps, listSeqQueue, cancelLead,
  copySeqSteps, planSchedule, getSeqConfig, getSeqStep, seqDbError,
  type SeqConfig, type SeqStep, type SeqQueueRow,
} from "@/lib/lead-sequence";

function canEdit(role: string | undefined): boolean { return role === "lead" || role === "exec"; }

export async function saveSeqConfigAction(c: SeqConfig): Promise<{ ok: boolean; error?: string; saved?: SeqConfig }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  try {
    await saveSeqConfig(c, u.name || u.id);
    // 저장 후 재조회 — "저장됐다"고만 말하지 않고 실제로 들어갔는지 확인한다.
    const saved = await getSeqConfig(c.channel_id);
    if (saved.days !== c.days || saved.hour !== c.hour || saved.enabled !== c.enabled) {
      return { ok: false, error: "저장은 됐는데 다시 읽은 값이 다릅니다 — 새로고침 후 확인해 주세요.", saved };
    }
    return { ok: true, saved };
  } catch (e) { return { ok: false, error: seqDbError(e) }; }
}

export async function saveSeqStepAction(step: SeqStep): Promise<{ ok: boolean; error?: string; saved?: SeqStep }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  try {
    await saveSeqStep(step, u.name || u.id);
    // 저장 후 재조회 — 문구가 실제로 DB 에 들어갔는지 대조한다(빈 값으로 돌아가는 문제 재발 방지).
    const saved = await getSeqStep(step.channel_id, step.day_no);
    if (!saved) return { ok: false, error: "저장 직후 다시 읽었는데 행이 없습니다 — 저장이 반영되지 않았습니다." };
    if (saved.sms_body !== (step.sms_body ?? "") || saved.email_body !== (step.email_body ?? "")
      || saved.email_subject !== (step.email_subject ?? "")) {
      return { ok: false, error: "저장된 문구가 입력한 내용과 다릅니다 — 다시 저장해 주세요.", saved };
    }
    return { ok: true, saved };
  } catch (e) { return { ok: false, error: seqDbError(e) }; }
}

export async function listSeqStepsAction(channelId: string, days: number): Promise<{ ok: boolean; steps?: SeqStep[]; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  try { return { ok: true, steps: await listSeqSteps(channelId, days) }; }
  catch (e) { return { ok: false, error: seqDbError(e) }; }
}

export async function listSeqQueueAction(channelId?: string): Promise<{ ok: boolean; rows?: SeqQueueRow[]; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  try { return { ok: true, rows: await listSeqQueue(channelId) }; }
  catch (e) { return { ok: false, error: seqDbError(e) }; }
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
  let n = 0;
  try { n = await copySeqSteps(fromKey, toKey, u.name || u.id); }
  catch (e) { return { ok: false, error: seqDbError(e) }; }
  // 기간도 원본에 맞춰 둬야 일차 수가 어긋나지 않는다.
  const from = await getSeqConfig(fromKey);
  const to = await getSeqConfig(toKey);
  if (from.days !== to.days) await saveSeqConfig({ ...to, days: from.days }, u.name || u.id).catch(() => {});
  return { ok: true, copied: n };
}

/** 특정 브랜드의 남은 예약 중단(수신거부 요청 등). */
export async function cancelSeqAction(brandId: string, note: string): Promise<{ ok: boolean; canceled?: number; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!canEdit(u.role)) return { ok: false, error: "권한 없음(파트장·대표만)" };
  const n = await cancelLead(brandId, note || "수동 중단");
  return { ok: true, canceled: n };
}
