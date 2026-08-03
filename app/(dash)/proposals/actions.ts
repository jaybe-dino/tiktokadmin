"use server";

// proposals 화면 전용 서버액션.
//  - 견적 빌더: computeQuote(단일 원천)로 계산 → addProposalV2(draft) → 선택 시 sent 발송기록.
//  - 목록 행 액션: 제안 상태 스텝 이동(draft→sent, sent→accepted/rejected).
// @/app/actions.ts 는 수정하지 않고 여기에 이 화면 전용 액션만 둔다.

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { computeQuote, type QuoteTerm } from "@/lib/quote";
import { aiEnabled, aiText } from "@/lib/ai";
import { query } from "@/lib/db";
import {
  addProposalV2,
  setProposalV2Status,
} from "@/lib/repo/card";

export interface ProposalActionResult {
  ok: boolean;
  error?: string;
  quote?: number;
  breakdown?: string;
  /** 할인 20% 초과 — 발송 보류, 파트장 결재 요청됨(결재함). */
  pendingApproval?: boolean;
}

// 추가 할인 결재선 기준: 20% 초과는 파트장(lead) 결재 필요.
const DISCOUNT_APPROVAL_THRESHOLD = 20;

// 견적 빌더 "제안서 생성 → 발송".
//   금액은 computeQuote 결과만 사용(수기 금액 금지). send=true 면 sent_at 기록까지.
export async function createAndSendProposalAction(input: {
  brand_id: string;
  plan: string;
  countries: string[];
  term: QuoteTerm;
  onboardingTier?: string;
  send?: boolean;
  /** 추가 할인 % (0~100). 20% 초과 시 발송 대신 파트장 결재 요청. */
  discountPct?: number;
}): Promise<ProposalActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };

  const discountPct = Number(input.discountPct ?? 0);
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    return { ok: false, error: "추가 할인은 0~100% 범위여야 합니다." };
  }

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

  // 할인 결재선: 20% 초과는 생성·발송하지 않고 파트장 결재 요청만 남긴다.
  // 승인 후 발송은 담당이 다시 진행(자동실행 없음 — /api/ops/approve 는 기록만).
  if (discountPct > DISCOUNT_APPROVAL_THRESHOLD) {
    try {
      await query(
        `INSERT INTO approval_requests (brand_id, kind, payload, requested_by)
         VALUES ($1, 'discount', $2, $3)`,
        [
          input.brand_id,
          JSON.stringify({
            brand_id: input.brand_id,
            plan: input.plan,
            countries: input.countries,
            term: input.term,
            discountPct,
            quote_amount: q.total,
            requested_by: `admin:${u.id}`,
          }),
          `admin:${u.id}`,
        ],
      );
    } catch {
      return { ok: false, error: "결재 요청 저장 실패" };
    }
    revalidatePath("/proposals");
    return { ok: true, pendingApproval: true, quote: q.total, breakdown: q.breakdown };
  }

  let id: string;
  try {
    id = await addProposalV2({
      brand_id: input.brand_id,
      plan: input.plan,
      countries: input.countries,
      term: input.term,
      quote_amount: q.total,
      discount_note:
        discountPct > 0 ? `${q.breakdown} | 추가할인 ${discountPct}%` : q.breakdown,
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

// ─────────────────────────────────────────────────────────────
// AI 제안서 커스텀 문구 생성.
//   선택 브랜드의 카드 맥락(카테고리·단계·목표국·plan/grade/추천트랙)과
//   견적 빌더의 현재 선택(plan·국가·약정)을 합쳐 제안서 소개/설득 문구를 생성.
//   복사용 초안만 만든다 — 판정(등급·게이트·정산)·개인정보(연락처 등)는 다루지 않는다.
// ─────────────────────────────────────────────────────────────

// state 코드 → 한글 라벨(퍼널 단계). 프롬프트 맥락용.
const STATE_KO: Record<string, string> = {
  lead_new: "신규 리드",
  seminar: "세미나",
  meeting: "미팅",
  contact: "컨택",
  contract_review: "계약 검토",
  contract_done: "계약 완료",
  docs: "서류",
  setup: "셋업",
  live_mall: "몰 운영",
  live_onboarding: "온보딩 운영",
  settling: "정산",
  dropped: "이탈",
  churned: "해지",
};

const PLAN_KO: Record<string, string> = {
  live_focus_490k: "Live Focus (49만)",
  guarantee_1m: "Guarantee (100만)",
  onboarding_onetime: "온보딩(원타임)",
  pro_89k: "Pro (8.9만)",
};

export interface AiCopyResult {
  ok: boolean;
  error?: string;
  text?: string;
}

export async function generateProposalCopyAction(input: {
  brand_id: string;
  plan?: string;
  countries?: string[];
  term?: QuoteTerm;
}): Promise<AiCopyResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  // 실데이터로 카드 맥락 구성(개인정보 컬럼은 조회하지 않는다).
  const rows = await query<{
    brand_name: string;
    brand_name_en: string | null;
    category: string | null;
    state: string;
    plan: string | null;
    grade: string | null;
    rec_track: string | null;
    contract_type: string | null;
    countries: string[] | null;
  }>(
    `SELECT brand_name, brand_name_en, category, state, plan, grade, rec_track, contract_type, countries
       FROM brands WHERE id = $1`,
    [input.brand_id],
  ).catch(() => []);
  const b = rows[0];
  if (!b) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 빌더에서 고른 값이 있으면 우선, 없으면 카드 저장값.
  const plan = input.plan || b.plan || "";
  const countries =
    input.countries && input.countries.length > 0
      ? input.countries
      : b.countries ?? [];
  const planLabel = PLAN_KO[plan] ?? plan ?? "미정";
  const stateLabel = STATE_KO[b.state] ?? b.state;

  const ctxLines = [
    `브랜드: ${b.brand_name}${b.brand_name_en ? ` (${b.brand_name_en})` : ""}`,
    `카테고리: ${b.category || "미상"}`,
    `현재 단계: ${stateLabel}`,
    `목표국: ${countries.length ? countries.join(", ") : "미정"}`,
    `플랜: ${planLabel}`,
    b.rec_track ? `추천 트랙: ${b.rec_track}` : "",
    input.term ? `약정: ${input.term === "6month" ? "6개월" : "3개월"}` : "",
  ].filter(Boolean);

  const system =
    "너는 글로벌 커머스 대행사 GloveK 의 B2B 세일즈 카피라이터다. " +
    "브랜드 맥락을 바탕으로 제안서에 넣을 한국어 소개/설득 문구 초안을 쓴다. " +
    "규칙: 사실 기반으로 담백하고 신뢰감 있게, 과장·허위 수치 금지. " +
    "등급·게이트·정산 등 내부 판정이나 개인정보(담당자명·연락처·사업자번호)는 절대 언급하지 마라. " +
    "출력은 (1) 한 줄 소개 헤드라인, (2) 3문장 내 소개 단락, (3) 불릿 3개 설득 포인트 순서로만.";
  const user =
    `아래 브랜드 맥락으로 제안서 커스텀 문구를 작성해줘.\n\n` +
    ctxLines.join("\n");

  const text = await aiText({ system, user, maxTokens: 700 });
  if (!text) return { ok: false, error: "문구 생성에 실패했습니다." };
  return { ok: true, text };
}
