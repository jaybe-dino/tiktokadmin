"use server";
// 마케팅 제안서 — 2번째 생성방식(설문 자동생성) 액션. 기존(mkt-proposals/actions.ts)은 건드리지 않는다.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/action";
import { generateMktProposal2 } from "@/lib/mkt-proposal2";
import { saveMktProposal } from "@/lib/mkt-proposal-doc";

export async function generateMktProposal2Action(brandId: string): Promise<{ ok: boolean; id?: string; warnings?: string[]; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!brandId) return { ok: false, error: "브랜드를 선택하세요." };
  try {
    const { input, warnings } = await generateMktProposal2(brandId);
    const { id } = await saveMktProposal(input, u.name || u.id);
    revalidatePath("/mkt-proposals2");
    return { ok: true, id, warnings };
  } catch (e) { return { ok: false, error: friendlyError(e, "마케팅 제안서2") }; }
}
