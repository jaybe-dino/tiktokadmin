"use server";

// proposals 화면 전용 서버액션.
//  - 견적 빌더: computeQuote(단일 원천)로 계산 → addProposalV2(draft) → 선택 시 sent 발송기록.
//  - 목록 행 액션: 제안 상태 스텝 이동(draft→sent, sent→accepted/rejected).
// @/app/actions.ts 는 수정하지 않고 여기에 이 화면 전용 액션만 둔다.

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { computeQuote, type QuoteTerm } from "@/lib/quote";
import {
  addProposalV2,
  setProposalV2Status,
} from "@/lib/repo/card";

export interface ProposalActionResult {
  ok: boolean;
  error?: string;
  quote?: number;
  breakdown?: string;
}

// 견적 빌더 "제안서 생성 → 발송".
//   금액은 computeQuote 결과만 사용(수기 금액 금지). send=true 면 sent_at 기록까지.
export async function createAndSendProposalAction(input: {
  brand_id: string;
  plan: string;
  countries: string[];
  term: QuoteTerm;
  onboardingTier?: string;
  send?: boolean;
}): Promise<ProposalActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };

  const isOnboarding = input.plan === "onboarding_onetime";
  if (!isOnboarding && input.countries.length === 0) {
    return { ok: false, error: "국가를 1개 이상 선택하세요." };
  }

  let q;
  try {
    q = computeQuote({
      plan: input.plan,
      countries: input.countries,
      term: input.term,
      onboardingTier: input.onboardingTier as
        | "3month"
        | "5month"
        | "12month"
        | undefined,
    });
  } catch {
    return { ok: false, error: "견적 계산 실패 — 트랙(플랜)을 확인하세요." };
  }

  let id: string;
  try {
    id = await addProposalV2({
      brand_id: input.brand_id,
      plan: input.plan,
      countries: input.countries,
      term: input.term,
      quote_amount: q.total,
      discount_note: q.breakdown,
      by: `admin:${u.id}`,
    });
  } catch {
    return { ok: false, error: "제안서 저장 실패" };
  }

  if (input.send) {
    // 발송 기록(sent_at 스탬프) — 계약검토 게이트 조건.
    await setProposalV2Status(id, "sent").catch(() => {});
  }

  revalidatePath("/proposals");
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true, quote: q.total, breakdown: q.breakdown };
}

// 목록 행 상태 스텝 이동. 허용된 전이만 통과시킨다.
const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected"],
};

export async function setProposalStatusV2Action(
  id: string,
  status: string,
  brandId?: string,
): Promise<ProposalActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!id) return { ok: false, error: "제안서 ID 누락" };

  // 현재 상태 확인 후 허용 전이만.
  const { queryOne } = await import("@/lib/db");
  const cur = await queryOne<{ status: string; brand_id: string }>(
    "SELECT status, brand_id FROM proposals WHERE id=$1",
    [id],
  ).catch(() => null);
  if (!cur) return { ok: false, error: "제안서를 찾을 수 없습니다." };

  const next = ALLOWED_NEXT[cur.status] ?? [];
  if (!next.includes(status)) {
    return { ok: false, error: `'${cur.status}' → '${status}' 전이는 허용되지 않습니다.` };
  }

  await setProposalV2Status(id, status);

  revalidatePath("/proposals");
  revalidatePath(`/brand/${brandId ?? cur.brand_id}`);
  return { ok: true };
}
