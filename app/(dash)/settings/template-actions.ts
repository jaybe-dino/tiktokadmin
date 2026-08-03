"use server";
// 발송 템플릿 CRUD 액션 (파트장/대표).
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { upsertTemplate, deleteTemplate } from "@/lib/templates";

async function lead() {
  const u = await currentUser();
  return u && (u.role === "lead" || u.role === "exec") ? u : null;
}

export async function upsertTemplateAction(t: { key: string; label: string; channel: "email" | "sms"; subject?: string; body: string }): Promise<{ ok: boolean; error?: string }> {
  const u = await lead();
  if (!u) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  try { await upsertTemplate(t, u.id); } catch (e) { return { ok: false, error: (e as Error).message }; }
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteTemplateAction(key: string): Promise<{ ok: boolean; error?: string }> {
  const u = await lead();
  if (!u) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  await deleteTemplate(key);
  revalidatePath("/settings");
  return { ok: true };
}
