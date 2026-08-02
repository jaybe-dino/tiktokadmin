"use server";

// QnA 지식베이스 화면 전용 서버액션.
// (@/app/actions.ts 는 수정 금지 규칙에 따라 이 화면 전용 파일로 분리)
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export interface QnaActionResult {
  ok: boolean;
  error?: string;
}

function isLead(role: string): boolean {
  return role === "lead" || role === "exec";
}

/** 직접 등록 — 담당자가 QnA를 신규 등록(승인 전 상태). */
export async function createQnaAction(input: {
  question: string;
  answer?: string;
  category?: string;
}): Promise<QnaActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, error: "질문을 입력하세요." };
  await query(
    `INSERT INTO qna_entries (question, answer, category, approved)
     VALUES ($1, $2, $3, false)`,
    [question, (input.answer ?? "").trim(), (input.category ?? "").trim()],
  );
  revalidatePath("/qna");
  return { ok: true };
}

/** 답변 작성/수정 — 담당자. 승인 상태는 건드리지 않음(파트장 승인 게이트 유지). */
export async function saveQnaAnswerAction(id: string, answer: string): Promise<QnaActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const body = (answer ?? "").trim();
  if (!body) return { ok: false, error: "답변 내용을 입력하세요." };
  await query(`UPDATE qna_entries SET answer=$2 WHERE id=$1`, [id, body]);
  revalidatePath("/qna");
  return { ok: true };
}

/** 승인(지식화) — 파트장/대표만. 답변이 있어야 승인 가능. */
export async function approveQnaAction(id: string): Promise<QnaActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!isLead(u.role)) return { ok: false, error: "권한 없음 (승인은 파트장/대표만)" };
  const row = await queryOne<{ answer: string | null }>(
    `SELECT answer FROM qna_entries WHERE id=$1`,
    [id],
  );
  if (!row) return { ok: false, error: "항목을 찾을 수 없습니다." };
  if (!(row.answer ?? "").trim()) return { ok: false, error: "답변이 작성돼야 승인할 수 있습니다." };
  await query(`UPDATE qna_entries SET approved=true WHERE id=$1`, [id]);
  revalidatePath("/qna");
  return { ok: true };
}

/** 승인 취소 — 파트장/대표만(잘못 지식화된 항목 회수). */
export async function unapproveQnaAction(id: string): Promise<QnaActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!isLead(u.role)) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  await query(`UPDATE qna_entries SET approved=false WHERE id=$1`, [id]);
  revalidatePath("/qna");
  return { ok: true };
}
