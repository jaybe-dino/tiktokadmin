import { query, queryOne } from "./db";
import type { Brand, State } from "./types";

// 게이트 규칙 (03-GATES-SLA §2). 각 전이의 통과조건.
// 하나라도 false 면 ops API 가 422 + 실패 항목(한국어 라벨)을 반환.
// 규칙은 GateContext(순수 객체) 위에서 평가 → 단위테스트 가능.

export interface GateContext {
  brand: Brand;
  hasMeetingNote: boolean; // brand_sources event=contact_logged(meeting)
  hasDiagnosis: boolean; // grade IS NOT NULL
  paymentConfirmed: boolean; // pay_status in(once_paid,subscribed) OR payments_manual 존재
  docTemplateCreated: boolean; // doc_items 존재
  allDocsDone: boolean; // doc_items 전부 done (항목 없으면 false)
  hasFirstPerformance: boolean; // brand_signals metric=first_gmv 존재
}

export interface Rule {
  key: string;
  label: string;
  test: (c: GateContext) => boolean;
}

const hasContact: Rule = {
  key: "hasContact",
  label: "담당자명 없음",
  test: (c) => Boolean(c.brand.contact_name?.trim()),
};
const hasEmailOrPhone: Rule = {
  key: "hasEmailOrPhone",
  label: "이메일/전화 없음",
  test: (c) => Boolean(c.brand.email || c.brand.phone),
};
const hasSource: Rule = {
  key: "hasSource",
  label: "유입경로 없음",
  test: (c) => Boolean(c.brand.source && c.brand.source !== "etc"),
};
const hasContractType: Rule = {
  key: "hasContractType",
  label: "계약형태 미정",
  test: (c) => Boolean(c.brand.contract_type),
};
const hasPlan: Rule = {
  key: "hasPlan",
  label: "플랜 미정",
  test: (c) => Boolean(c.brand.plan),
};
const hasBizNo: Rule = {
  key: "hasBizNo",
  label: "사업자번호 없음",
  test: (c) => Boolean(c.brand.biz_no),
};
const hasMeetingNote: Rule = {
  key: "hasMeetingNote",
  label: "회의록 없음",
  test: (c) => c.hasMeetingNote,
};
const hasDiagnosis: Rule = {
  key: "hasDiagnosis",
  label: "사전분석(등급) 없음",
  test: (c) => c.hasDiagnosis,
};
const paymentConfirmed: Rule = {
  key: "paymentConfirmed",
  label: "결제 미확인",
  test: (c) => c.paymentConfirmed,
};
const docTemplateCreated: Rule = {
  key: "docTemplateCreated",
  label: "서류 템플릿 미생성",
  test: (c) => c.docTemplateCreated,
};
const allDocsDone: Rule = {
  key: "allDocsDone",
  label: "서류 미완(100% 아님)",
  test: (c) => c.allDocsDone,
};
const hasFirstPerformance: Rule = {
  key: "hasFirstPerformance",
  label: "첫 성과(first_gmv) 없음",
  test: (c) => c.hasFirstPerformance,
};

function assigned(field: keyof Brand, label: string): Rule {
  return { key: `assigned:${String(field)}`, label, test: (c) => Boolean(c.brand[field]) };
}
function eq(field: keyof Brand, value: string, label: string): Rule {
  return { key: `eq:${String(field)}=${value}`, label, test: (c) => c.brand[field] === value };
}

export const GATES: Record<string, Rule[]> = {
  "lead_new→meeting": [hasContact, hasEmailOrPhone, hasSource, assigned("owner_intake", "유입담당 미지정")],
  "seminar→meeting": [hasContact, assigned("owner_intake", "유입담당 미지정")],
  "meeting→contact": [hasMeetingNote, assigned("owner_sales", "영업담당 미지정"), hasDiagnosis],
  "contact→contract_review": [hasContractType, hasPlan],
  "contact→contract_done": [hasContractType, hasPlan, paymentConfirmed],
  "contract_review→contract_done": [paymentConfirmed],
  "contract_done→docs": [assigned("owner_onboard", "온보딩담당 미지정"), docTemplateCreated],
  "docs→setup": [allDocsDone, hasBizNo],
  "setup→live_mall": [eq("contract_type", "mall", "계약형태 mall 아님"), assigned("owner_ads", "광고담당 미지정")],
  "setup→live_onboarding": [eq("contract_type", "onboarding", "계약형태 onboarding 아님"), assigned("owner_ads", "광고담당 미지정")],
  "live_mall→settling": [eq("pay_status", "subscribed", "구독상태 아님"), hasFirstPerformance],
  "live_onboarding→settling": [hasFirstPerformance],
};

export interface GateResult {
  passed: boolean;
  failed: { rule: string; label: string }[];
}

/** 순수 평가 — 전이 키에 게이트가 없으면 통과. */
export function evaluateGate(from: State, to: State, ctx: GateContext): GateResult {
  const rules = GATES[`${from}→${to}`];
  if (!rules) return { passed: true, failed: [] };
  const failed = rules
    .filter((r) => !r.test(ctx))
    .map((r) => ({ rule: r.key, label: r.label }));
  return { passed: failed.length === 0, failed };
}

/** DB 에서 GateContext 조립. */
export async function buildGateContext(brand: Brand): Promise<GateContext> {
  const [meetingNote, manualPay, docStats, firstPerf] = await Promise.all([
    queryOne<{ n: string }>(
      `SELECT count(*)::text n FROM brand_sources
        WHERE brand_id=$1 AND event='contact_logged'
          AND payload->>'channel'='meeting'`,
      [brand.id],
    ),
    queryOne<{ n: string }>(`SELECT count(*)::text n FROM payments_manual WHERE brand_id=$1`, [brand.id]),
    queryOne<{ total: string; done: string }>(
      `SELECT count(*)::text total, count(*) FILTER (WHERE done)::text done
         FROM doc_items WHERE brand_id=$1`,
      [brand.id],
    ),
    queryOne<{ n: string }>(
      `SELECT count(*)::text n FROM brand_signals WHERE brand_id=$1 AND metric='first_gmv'`,
      [brand.id],
    ),
  ]);

  const total = Number(docStats?.total ?? 0);
  const done = Number(docStats?.done ?? 0);
  const manualPayCount = Number(manualPay?.n ?? 0);

  return {
    brand,
    hasMeetingNote: Number(meetingNote?.n ?? 0) > 0,
    hasDiagnosis: brand.grade != null,
    paymentConfirmed:
      brand.pay_status === "once_paid" ||
      brand.pay_status === "subscribed" ||
      manualPayCount > 0,
    docTemplateCreated: total > 0,
    allDocsDone: total > 0 && done === total,
    hasFirstPerformance: Number(firstPerf?.n ?? 0) > 0,
  };
}

/** 게이트 실패 라벨을 사람이 읽는 문장으로. */
export function failedLabels(res: GateResult): string {
  return res.failed.map((f) => f.label).join(" · ");
}
