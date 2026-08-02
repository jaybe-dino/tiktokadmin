"use server";

// contracts 화면 전용 서버액션.
//  - 결제 안내 메일 발송: canSend 게이트(거래성 payment_notice) 경유 → 메일 발송 → 접촉 기록.
//  - 계약 상태 스텝 이동: 현재 상태 확인 후 허용 전이만 setContractStatus.
// @/app/actions.ts 는 수정하지 않고 이 화면 전용 액션만 여기에 둔다.

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { canSend } from "@/lib/lifecycle";

export interface ContractsActionResult {
  ok: boolean;
  error?: string;
  sent?: boolean;
}

// ① glovek 카드결제 안내 메일 발송.
//   거래성(payment_notice) 이지만 발송 전 반드시 canSend 게이트를 경유한다(규칙 2).
export async function sendPaymentGuideAction(input: {
  brandId: string;
  item: string;
}): Promise<ContractsActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brandId) return { ok: false, error: "브랜드를 선택하세요." };

  const gate = await canSend(input.brandId, "payment_notice");
  if (!gate.ok) return { ok: false, error: gate.reason };

  const { getBrand } = await import("@/lib/repo/brands");
  const brand = await getBrand(input.brandId);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };
  if (!brand.email) return { ok: false, error: "브랜드 이메일이 없습니다." };

  const item = input.item?.trim() || "결제";
  const subject = `[GloveK] ${item} 결제 안내`;
  const text =
    `안녕하세요, ${brand.brand_name} 담당자님.\n\n` +
    `${item} 결제를 안내드립니다.\n` +
    `glovek 로그인 후 카드결제를 진행해 주세요. 결제가 완료되면 자동으로 확인됩니다.\n\n` +
    `감사합니다.\nGloveK 드림`;

  const { sendEmail } = await import("@/lib/mailer");
  const r = await sendEmail({ to: brand.email, subject, text });
  if (!r.ok && !r.skipped) return { ok: false, error: r.error ?? "메일 발송 실패" };

  // 발송 기록: contact_logged(email) + last_contact_at (sendSmsAction 패턴)
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
     VALUES ($1,'admin','contact_logged',$2,now())`,
    [input.brandId, JSON.stringify({ channel: "email", kind: "payment_notice", item })],
  ).catch(() => {});
  await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [input.brandId]).catch(() => {});

  revalidatePath("/contracts");
  revalidatePath(`/brand/${input.brandId}`);
  return { ok: true, sent: r.ok };
}

// 계약 상태 스텝 이동. 허용된 전이만 통과시킨다(설명적 상태 흐름).
const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ["review", "sent"],
  review: ["sent"],
  sent: ["signed", "expired", "terminated"],
  signed: ["terminated"],
};

export async function stepContractStatusAction(
  id: string,
  brandId: string,
  next: string,
): Promise<ContractsActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!id) return { ok: false, error: "계약 ID 누락" };

  const { queryOne } = await import("@/lib/db");
  const cur = await queryOne<{ status: string; brand_id: string }>(
    "SELECT status, brand_id FROM contracts WHERE id=$1",
    [id],
  ).catch(() => null);
  if (!cur) return { ok: false, error: "계약을 찾을 수 없습니다." };

  const allowed = ALLOWED_NEXT[cur.status] ?? [];
  if (!allowed.includes(next)) {
    return { ok: false, error: `'${cur.status}' → '${next}' 전이는 허용되지 않습니다.` };
  }

  const { setContractStatus } = await import("@/lib/repo/card");
  await setContractStatus(id, next); // status='signed' 시 signed_at 자동 스탬프

  revalidatePath("/contracts");
  revalidatePath(`/brand/${brandId || cur.brand_id}`);
  return { ok: true };
}
