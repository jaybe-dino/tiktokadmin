"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { setTicketStatus } from "@/lib/cs";

export interface CsActionResult {
  ok: boolean;
  error?: string;
}

/** CS 티켓 상태 변경 (해결/종료/재오픈). @/lib/cs.setTicketStatus 경유 — resolved_at 자동 처리. */
export async function setTicketStatusAction(id: string, status: string): Promise<CsActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const allowed = ["open", "in_progress", "resolved", "closed"];
  if (!allowed.includes(status)) return { ok: false, error: "허용되지 않은 상태" };
  await setTicketStatus(id, status);
  revalidatePath("/cs");
  return { ok: true };
}

/** 담당자 배정 (본인). cs_tickets.assignee 컬럼만 갱신(브랜드 상태전이 아님). */
export async function assignTicketAction(id: string, toMe = true): Promise<CsActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const { query } = await import("@/lib/db");
  await query("UPDATE cs_tickets SET assignee=$2 WHERE id=$1", [id, toMe ? u.name : null]);
  revalidatePath("/cs");
  return { ok: true };
}

/** 티켓 우선순위 변경. sla_due 재계산(urgent 4h / 그 외 24h, 생성시각 기준). */
export async function setTicketPriorityAction(id: string, priority: string): Promise<CsActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const allowed = ["urgent", "high", "normal", "low"];
  if (!allowed.includes(priority)) return { ok: false, error: "허용되지 않은 우선순위" };
  const { query } = await import("@/lib/db");
  const hours = priority === "urgent" ? 4 : 24;
  await query(
    `UPDATE cs_tickets SET priority=$2, sla_due = created_at + ($3 || ' hours')::interval WHERE id=$1`,
    [id, priority, String(hours)],
  );
  revalidatePath("/cs");
  return { ok: true };
}
