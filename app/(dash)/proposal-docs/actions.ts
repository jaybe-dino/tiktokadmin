"use server";
// 제안서 생성기(웹 제안서) 어드민 액션 — 생성/저장/발행/삭제 + 템플릿 저장.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import {
  saveProposal, deleteProposal, prefillFromBrand, saveTemplate,
  type ProposalInput, type TemplateInput,
} from "@/lib/proposal-doc";

export async function createProposalDocAction(brandId: string | null): Promise<{ ok: boolean; id?: string; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  try {
    const prefill: ProposalInput = brandId ? await prefillFromBrand(brandId) : {};
    const { id } = await saveProposal(prefill, u.name || u.id);
    revalidatePath("/proposal-docs");
    return { ok: true, id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "생성 실패" }; }
}

export async function saveProposalDocAction(input: ProposalInput & { id: string }): Promise<{ ok: boolean; token?: string; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  try {
    const { token } = await saveProposal(input, u.name || u.id);
    revalidatePath("/proposal-docs");
    revalidatePath(`/proposal-docs/${input.id}`);
    return { ok: true, token };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "저장 실패" }; }
}

export async function deleteProposalDocAction(id: string): Promise<{ ok: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  await deleteProposal(id).catch(() => {});
  revalidatePath("/proposal-docs");
  return { ok: true };
}

export async function saveTemplateAction(input: TemplateInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  try {
    const { id } = await saveTemplate(input, u.name || u.id);
    revalidatePath("/proposal-docs/templates");
    return { ok: true, id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "저장 실패" }; }
}
