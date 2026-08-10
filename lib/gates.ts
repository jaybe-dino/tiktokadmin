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
  hasSentProposal: boolean; // proposals.status='sent' 존재 (10-C)
  hasPreSurvey: boolean; // 1:1 사전학습 설문(pre_meeting) 발송/작성됨
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
const hasSentProposal: Rule = {
  key: "hasSentProposal",
  label: "제안서 발송 기록 없음",
  test: (c) => c.hasSentProposal,
};
// 1:1 미팅 → 컨택: 사전학습 설문(pre_meeting)에 내용이 입력(발송)됐는지 확인
const hasPreSurvey: Rule = {
  key: "hasPreSurvey",
  label: "1:1 사전학습 설문 미발송 — 설문 발송 후 컨택으로",
  test: (c) => c.hasPreSurvey,
};

function assigned(field: keyof Brand, label: string): Rule {
  return { key: `assigned:${String(field)}`, label, test: (c) => Boolean(c.brand[field]) };
}
function eq(field: keyof Brand, value: string, label: string): Rule {
  return { key: `eq:${String(field)}=${value}`, label, test: (c) => c.brand[field] === value };
}

// 기획 확정: 운영(live) 전이 전 등급 5대 지표(q1~q5) 전부 입력 필수(충족/미충족 무관, 미입력만 차단)
const gradeChecksComplete: Rule = {
  key: "gradeChecksComplete",
  label: "등급 5대 지표 미입력 — 브랜드360에서 담당 보정 입력 필요",
  test: (c) => {
    const gc = (c.brand as unknown as Record<string, unknown>).grade_checks as Record<string, boolean> | null;
    if (!gc) return false;
    return (["q1", "q2", "q3", "q4", "q5"] as const).every((k) => k in gc);
  },
};

export const GATES: Record<string, Rule[]> = {
  "lead_new→meeting": [hasContact, hasEmailOrPhone, hasSource, assigned("owner_intake", "유입담당 미지정")],
  "seminar→meeting": [hasContact, assigned("owner_intake", "유입담당 미지정")],
  "meeting→contact": [hasMeetingNote, assigned("owner_sales", "영업담당 미지정"), hasDiagnosis, hasPreSurvey],
  "contact→contract_review": [hasContractType, hasPlan, hasSentProposal, gradeChecksComplete],
  "contact→contract_done": [hasContractType, hasPlan, hasSentProposal, paymentConfirmed, gradeChecksComplete],
  "contract_review→contract_done": [paymentConfirmed],
  "contract_done→docs": [assigned("owner_onboard", "온보딩담당 미지정"), docTemplateCreated],
  "docs→setup": [allDocsDone, hasBizNo],
  "setup→live_mall": [eq("contract_type", "mall", "계약형태 mall 아님"), assigned("owner_ads", "광고담당 미지정"), gradeChecksComplete],
  "setup→live_onboarding": [eq("contract_type", "onboarding", "계약형태 onboarding 아님"), assigned("owner_ads", "광고담당 미지정"), gradeChecksComplete],
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
  // 게이트 컨텍스트 조립 — 6개 count 를 단일 쿼리(서브셀렉트)로 묶어 왕복 6→1.
  //   미적용 DB(테이블 누락) 등으로 실패 시엔 기존 개별 쿼리 경로로 폴백(회복력 유지).
  const c = await gateCounts(brand.id);

  const total = c.docTotal;
  const done = c.docDone;
  const manualPayCount = c.manualPay;

  return {
    brand,
    hasMeetingNote: c.meetingNote > 0,
    hasDiagnosis: brand.grade != null,
    paymentConfirmed:
      brand.pay_status === "once_paid" ||
      brand.pay_status === "subscribed" ||
      manualPayCount > 0,
    docTemplateCreated: total > 0,
    allDocsDone: total > 0 && done === total,
    hasFirstPerformance: c.firstPerf > 0,
    hasSentProposal: c.sentProposal > 0,
    hasPreSurvey: c.preSurvey > 0,
  };
}

interface GateCounts {
  meetingNote: number; manualPay: number; docTotal: number; docDone: number;
  firstPerf: number; sentProposal: number; preSurvey: number;
}

/** 게이트용 count 7종을 단일 쿼리로. 실패(테이블 누락 등) 시 개별 쿼리 폴백 → 회복력 유지.
 *  반환값은 기존 개별 쿼리 경로와 동일(가드: tests/gates-counts 및 앱 렌더 비교로 검증). */
async function gateCounts(brandId: string): Promise<GateCounts> {
  const one = await queryOne<{
    meeting_note: string; manual_pay: string; doc_total: string; doc_done: string;
    first_perf: string; sent_proposal: string; pre_survey: string;
  }>(
    `SELECT
       (SELECT count(*) FROM brand_sources WHERE brand_id=$1 AND event='contact_logged' AND payload->>'channel'='meeting') AS meeting_note,
       (SELECT count(*) FROM payments_manual WHERE brand_id=$1) AS manual_pay,
       (SELECT count(*) FROM doc_items WHERE brand_id=$1) AS doc_total,
       (SELECT count(*) FROM doc_items WHERE brand_id=$1 AND done) AS doc_done,
       (SELECT count(*) FROM brand_signals WHERE brand_id=$1 AND metric='first_gmv') AS first_perf,
       (SELECT count(*) FROM proposals WHERE brand_id=$1 AND status='sent') AS sent_proposal,
       (SELECT count(*) FROM surveys WHERE brand_id=$1 AND kind='pre_meeting' AND sent_at IS NOT NULL) AS pre_survey`,
    [brandId],
  ).catch(() => null);
  if (one) {
    return {
      meetingNote: Number(one.meeting_note), manualPay: Number(one.manual_pay),
      docTotal: Number(one.doc_total), docDone: Number(one.doc_done),
      firstPerf: Number(one.first_perf), sentProposal: Number(one.sent_proposal),
      preSurvey: Number(one.pre_survey),
    };
  }
  // 폴백 — 개별 쿼리(누락 테이블은 0). 병합 쿼리가 실패해도 게이트가 죽지 않게.
  const [mn, mp, ds, fp, sp, ps] = await Promise.all([
    queryOne<{ n: string }>(`SELECT count(*)::text n FROM brand_sources WHERE brand_id=$1 AND event='contact_logged' AND payload->>'channel'='meeting'`, [brandId]).catch(() => ({ n: "0" })),
    queryOne<{ n: string }>(`SELECT count(*)::text n FROM payments_manual WHERE brand_id=$1`, [brandId]).catch(() => ({ n: "0" })),
    queryOne<{ total: string; done: string }>(`SELECT count(*)::text total, count(*) FILTER (WHERE done)::text done FROM doc_items WHERE brand_id=$1`, [brandId]).catch(() => ({ total: "0", done: "0" })),
    queryOne<{ n: string }>(`SELECT count(*)::text n FROM brand_signals WHERE brand_id=$1 AND metric='first_gmv'`, [brandId]).catch(() => ({ n: "0" })),
    queryOne<{ n: string }>(`SELECT count(*)::text n FROM proposals WHERE brand_id=$1 AND status='sent'`, [brandId]).catch(() => ({ n: "0" })),
    queryOne<{ n: string }>(`SELECT count(*)::text n FROM surveys WHERE brand_id=$1 AND kind='pre_meeting' AND sent_at IS NOT NULL`, [brandId]).catch(() => ({ n: "0" })),
  ]);
  return {
    meetingNote: Number(mn?.n ?? 0), manualPay: Number(mp?.n ?? 0),
    docTotal: Number(ds?.total ?? 0), docDone: Number(ds?.done ?? 0),
    firstPerf: Number(fp?.n ?? 0), sentProposal: Number(sp?.n ?? 0), preSurvey: Number(ps?.n ?? 0),
  };
}

/** 게이트 실패 라벨을 사람이 읽는 문장으로. */
export function failedLabels(res: GateResult): string {
  return res.failed.map((f) => f.label).join(" · ");
}
