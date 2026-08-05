"use server";
// 관리자 온보딩 검토 액션 — 고객 발급 / 단계 검토 / 전체 승인+매핑.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import {
  issueCustomer, setCustomerActive, setCustomerBrand, reviewStep, approveApplication,
} from "@/lib/onboarding";

export async function issueCustomerAction(email: string, brandId: string | null, note: string, sendMail?: boolean): Promise<{ ok: boolean; code?: string; error?: string; mailed?: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const r = await issueCustomer(email, brandId || null, note, u.id);
  if (!r.ok) return r;
  revalidatePath("/onboarding");
  // 선택: 발급 코드+로그인 링크를 고객에게 이메일 발송.
  let mailed: boolean | undefined;
  if (sendMail && r.code) {
    const { sendEmail } = await import("@/lib/mailer");
    const base = process.env.NEXT_PUBLIC_PORTAL_URL || "https://tiktok.glovek.space";
    const res = await sendEmail({
      to: email.trim(),
      subject: "[TikTok Shop 온보딩] 신청서 작성 안내",
      text: `안녕하세요.\n\nTikTok Shop 온보딩 신청서 작성을 위한 계정이 발급되었습니다.\n\n• 로그인: ${base}/apply\n• 이메일: ${email.trim()}\n• 발급코드: ${r.code}\n\n위 링크에서 이메일과 발급코드로 로그인해 4단계 신청서를 작성해 주세요.\n감사합니다.`,
    }).catch(() => ({ ok: false }));
    mailed = res.ok;
  }
  return { ...r, mailed };
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
