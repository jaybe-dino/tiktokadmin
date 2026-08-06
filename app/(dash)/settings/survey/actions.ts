"use server";
// 설문 문항 뱅크 편집 — 어드민이 문항 추가/수정/삭제/정렬/활성 토글.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { upsertQuestion, deleteQuestion, reorderQuestions, type QuestionInput } from "@/lib/survey-db";

export async function saveQuestionAction(input: QuestionInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.qkey?.trim()) return { ok: false, error: "문항 키(qkey)를 입력하세요." };
  if (!input.label?.trim()) return { ok: false, error: "문항 라벨을 입력하세요." };
  try {
    const { id } = await upsertQuestion(input);
    revalidatePath("/settings/survey");
    return { ok: true, id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "저장 실패" }; }
}

export async function deleteQuestionAction(id: string): Promise<{ ok: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  await deleteQuestion(id).catch(() => {});
  revalidatePath("/settings/survey");
  return { ok: true };
}

export async function reorderQuestionsAction(orders: { id: string; sort_order: number }[]): Promise<{ ok: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  await reorderQuestions(orders);
  revalidatePath("/settings/survey");
  return { ok: true };
}
