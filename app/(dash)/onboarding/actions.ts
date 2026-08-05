"use server";
// 관리자 온보딩 검토 액션 — 고객 발급 / 단계 검토 / 전체 승인+매핑.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import {
  issueCustomer, setCustomerActive, setCustomerBrand, reviewStep, approveApplication,
} from "@/lib/onboarding";

export async function issueCustomerAction(email: string, brandId: string | null, note: string) {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const r = await issueCustomer(email, brandId || null, note, u.id);
  if (r.ok) revalidatePath("/onboarding");
  return r;
}

export async function setOnbCustomerActiveAction(id: string, active: boolean) {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const r = await setCustomerActive(id, active);
  revalidatePath("/onboarding");
  return r;
}

export async function setOnbCustomerBrandAction(customerId: string, brandId: string | null) {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const r = await setCustomerBrand(customerId, brandId || null);
  revalidatePath("/onboarding");
  return r;
}

export async function reviewStepAction(applicationId: string, stepNo: number, decision: "approve" | "reject", feedback: string) {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const r = await reviewStep(applicationId, stepNo, decision, feedback);
  if (r.ok) { revalidatePath("/onboarding"); revalidatePath(`/onboarding`); }
  return r;
}

export async function approveApplicationAction(applicationId: string) {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const r = await approveApplication(applicationId, u.name || u.id);
  if (r.ok) revalidatePath("/onboarding");
  return r;
}
