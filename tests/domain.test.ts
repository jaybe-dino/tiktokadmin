import { describe, expect, it } from "vitest";
import { countChecks, gradeFromChecks, gradeFromCount, recommendedTrack } from "../lib/grade";
import { extractKeys, normalizeBizNo, normalizeEmail, normalizePhone, urlHost } from "../lib/dedup";
import { canTerminate, isAhead, isTransitionAllowed, ownerFieldForState } from "../lib/states";
import { evaluateGate, type GateContext } from "../lib/gates";
import { businessDaysBetween, mondayOfWeekKst } from "../lib/time";
import { checkSlaBreach, tierFromDaysOver } from "../lib/sla";
import { resolvePaymentEffect } from "../lib/ingest";
import { evaluateRequirements, type StageRequirement } from "../lib/requirements";
import { makeBrand } from "./factory";

// ── grade (glovek gradeFromChecks 동일) ──────────────────────
describe("grade", () => {
  it("5→S, 4→A, 2~3→B, 0~1→C", () => {
    expect(gradeFromCount(5)).toBe("S");
    expect(gradeFromCount(4)).toBe("A");
    expect(gradeFromCount(3)).toBe("B");
    expect(gradeFromCount(2)).toBe("B");
    expect(gradeFromCount(1)).toBe("C");
    expect(gradeFromCount(0)).toBe("C");
  });
  it("gradeFromChecks 카운트 반영", () => {
    expect(countChecks({ q1: true, q2: true, q3: true, q4: true, q5: true })).toBe(5);
    expect(gradeFromChecks({ q1: true, q2: true, q3: true, q4: true, q5: true })).toBe("S");
    expect(gradeFromChecks({ q1: true })).toBe("C");
    expect(gradeFromChecks({ q1: true, q2: true })).toBe("B");
  });
  it("추천 트랙: S/A→onboarding, B/C→live", () => {
    expect(recommendedTrack("S")).toBe("onboarding");
    expect(recommendedTrack("A")).toBe("onboarding");
    expect(recommendedTrack("B")).toBe("live");
    expect(recommendedTrack("C")).toBe("live");
  });
});

// ── dedup 정규화 ─────────────────────────────────────────────
describe("dedup normalize", () => {
  it("email 소문자/trim", () => {
    expect(normalizeEmail("  A@B.com ")).toBe("a@b.com");
    expect(normalizeEmail("")).toBeNull();
  });
  it("phone/biz_no 숫자만", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizeBizNo("123-45-67890")).toBe("1234567890");
    expect(normalizePhone("--")).toBeNull();
  });
  it("urlHost www 제거·소문자", () => {
    expect(urlHost("https://www.Smartstore.naver.com/shop")).toBe("smartstore.naver.com");
    expect(urlHost("brand.co.kr")).toBe("brand.co.kr");
  });
  it("extractKeys dedup 요건", () => {
    const k = extractKeys({ email: "X@Y.com", phone: "010", brand_name: " A ", brand_url: "a.com" });
    expect(k.email).toBe("x@y.com");
    expect(k.brand_name).toBe("A");
  });
});

// ── 상태 머신 ────────────────────────────────────────────────
describe("state machine", () => {
  it("전진 전이 허용", () => {
    expect(isTransitionAllowed("inquiry", "meeting").allowed).toBe(true);
    expect(isTransitionAllowed("contact", "contract_done").allowed).toBe(true);
    expect(isTransitionAllowed("setup", "live").allowed).toBe(true);
  });
  it("허용되지 않은 점프 거부", () => {
    expect(isTransitionAllowed("inquiry", "setup").allowed).toBe(false);
    expect(isTransitionAllowed("meeting", "contract_done").allowed).toBe(false);
  });
  it("유입 상태끼리 전환 허용", () => {
    expect(isTransitionAllowed("inquiry", "seminar").allowed).toBe(true);
    expect(isTransitionAllowed("seminar", "expo").allowed).toBe(true);
  });
  it("후퇴는 lead/exec 만", () => {
    expect(isTransitionAllowed("contact", "meeting", "sales").allowed).toBe(false);
    expect(isTransitionAllowed("contact", "meeting", "lead").allowed).toBe(true);
    expect(isTransitionAllowed("contact", "meeting", "exec").allowed).toBe(true);
  });
  it("dropped 는 어디서든, churned 는 live·settling 만", () => {
    expect(canTerminate("inquiry", "dropped")).toBe(true);
    expect(canTerminate("inquiry", "churned")).toBe(false);
    expect(canTerminate("live", "churned")).toBe(true);
    expect(canTerminate("settling", "churned")).toBe(true);
  });
  it("isAhead 퍼널 서열", () => {
    expect(isAhead("contact", "inquiry")).toBe(true);
    expect(isAhead("inquiry", "contact")).toBe(false);
  });
  it("담당 필드 매핑", () => {
    expect(ownerFieldForState("meeting")).toBe("owner_intake");
    expect(ownerFieldForState("contact")).toBe("owner_sales");
    expect(ownerFieldForState("setup")).toBe("owner_onboard");
    expect(ownerFieldForState("live")).toBe("owner_ads");
  });
});

// ── 게이트 평가 (순수) ───────────────────────────────────────
function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    brand: makeBrand(),
    hasMeetingNote: false,
    hasDiagnosis: false,
    paymentConfirmed: false,
    docTemplateCreated: false,
    allDocsDone: false,
    hasFirstPerformance: false,
    ...over,
  };
}

describe("gates", () => {
  it("게이트 없는 전이는 통과", () => {
    expect(evaluateGate("inquiry", "seminar", ctx()).passed).toBe(true);
  });
  it("meeting→contact: 회의록·영업담당 필요", () => {
    const bad = evaluateGate("meeting", "contact", ctx());
    expect(bad.passed).toBe(false);
    expect(bad.failed.map((f) => f.label)).toContain("회의록 없음");

    const good = evaluateGate(
      "meeting",
      "contact",
      ctx({
        brand: makeBrand({ owner_sales: "sales@x.com" }),
        hasMeetingNote: true,
      }),
    );
    expect(good.passed).toBe(true);
  });
  it("contact→contract_done: 결제 확인 필요", () => {
    const b = makeBrand({ contract_type: "glovek", plan: "live_focus_490k" });
    expect(evaluateGate("contact", "contract_done", ctx({ brand: b })).passed).toBe(false);
    expect(
      evaluateGate("contact", "contract_done", ctx({ brand: b, paymentConfirmed: true })).passed,
    ).toBe(true);
  });
  it("contract_done→setup: 온보딩담당 필요", () => {
    const b = makeBrand();
    expect(evaluateGate("contract_done", "setup", ctx({ brand: b })).passed).toBe(false);
    expect(
      evaluateGate("contract_done", "setup", ctx({ brand: makeBrand({ owner_onboard: "o@x.com" }) })).passed,
    ).toBe(true);
  });
});

// ── 시간/SLA ─────────────────────────────────────────────────
describe("time & sla", () => {
  it("영업일 계산 주말 제외", () => {
    // 2026-07-24(금) → 2026-07-28(화): 월·화 2영업일 (토·일 제외)
    const fri = new Date("2026-07-24T01:00:00Z");
    const tue = new Date("2026-07-28T01:00:00Z");
    expect(businessDaysBetween(fri, tue)).toBe(2);
  });
  it("주말만 사이면 0영업일", () => {
    const sat = new Date("2026-07-25T01:00:00Z");
    const sun = new Date("2026-07-26T12:00:00Z");
    expect(businessDaysBetween(sat, sun)).toBe(0);
  });
  it("tier 계산", () => {
    expect(tierFromDaysOver(0)).toBe(0);
    expect(tierFromDaysOver(1)).toBe(1);
    expect(tierFromDaysOver(2)).toBe(2);
    expect(tierFromDaysOver(5)).toBe(3);
  });
  it("checkSlaBreach: inquiry 2일 초과 시 위반", () => {
    const policies = { inquiry: 2 };
    const b = makeBrand({ state: "inquiry", stage_entered_at: "2026-07-20T00:00:00Z" });
    const now = new Date("2026-07-27T00:00:00Z"); // 월(20)~월(27), 주말2 제외 5영업일
    const breach = checkSlaBreach(b, policies, now);
    expect(breach).not.toBeNull();
    expect(breach!.daysOver).toBeGreaterThan(0);
  });
  it("mondayOfWeekKst 반환 형식", () => {
    expect(mondayOfWeekKst(new Date("2026-07-29T05:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── 결제 효과 (Pro vs 멀티몰 분기) ────────────────────────────
describe("resolvePaymentEffect", () => {
  it("멀티몰 첫 결제 → 계약(mall) + contract_done 전진", () => {
    const e = resolvePaymentEffect("subscribe_first", "live_focus_490k");
    expect(e.contractType).toBe("glovek");
    expect(e.payStatus).toBe("subscribed");
    expect(e.candidate).toBe("contract_done");
  });
  it("Pro 첫 결제 → 구독표시만, 계약·전진 없음(별도 상품군)", () => {
    const e = resolvePaymentEffect("subscribe_first", "pro_89k");
    expect(e.payStatus).toBe("subscribed");
    expect(e.contractType).toBeUndefined();
    expect(e.candidate).toBeUndefined();
  });
  it("온보딩 일회 → 계약(onboarding) + contract_done", () => {
    const e = resolvePaymentEffect("once", "onboarding_onetime");
    expect(e.contractType).toBe("onboarding");
    expect(e.payStatus).toBe("once_paid");
    expect(e.candidate).toBe("contract_done");
  });
  it("갱신 실패/성공, 해지", () => {
    expect(resolvePaymentEffect("subscribe_renew", "pro_89k", "fail").payStatus).toBe("past_due");
    expect(resolvePaymentEffect("subscribe_renew", "pro_89k", "ok").payStatus).toBe("subscribed");
    expect(resolvePaymentEffect("cancel", "live_focus_490k").payStatus).toBe("canceled");
  });
});

// ── 단계별 필수항목 평가 ─────────────────────────────────────
describe("stage requirements", () => {
  const reqs: StageRequirement[] = [
    { id: "r1", state: "meeting", kind: "field", field_key: "category", label: "카테고리 입력", required: true, sort: 1, active: true },
    { id: "r2", state: "meeting", kind: "check", field_key: null, label: "니즈 파악", required: true, sort: 2, active: true },
    { id: "r3", state: "contact", kind: "check", field_key: null, label: "제안서 발송", required: true, sort: 1, active: true },
    { id: "r4", state: "meeting", kind: "check", field_key: null, label: "비활성 항목", required: true, sort: 3, active: false },
  ];
  it("현재 단계의 미충족 항목만 반환", () => {
    const brand = makeBrand({ state: "meeting", category: "" });
    const unmet = evaluateRequirements(brand, reqs, new Set());
    expect(unmet.map((u) => u.label).sort()).toEqual(["니즈 파악", "카테고리 입력"]);
  });
  it("field 채워지고 check 완료면 통과", () => {
    const brand = makeBrand({ state: "meeting", category: "뷰티" });
    const unmet = evaluateRequirements(brand, reqs, new Set(["r2"]));
    expect(unmet).toHaveLength(0);
  });
  it("비활성 항목·다른 단계 항목은 무시", () => {
    const brand = makeBrand({ state: "meeting", category: "뷰티" });
    const unmet = evaluateRequirements(brand, reqs, new Set(["r2"]));
    expect(unmet.map((u) => u.label)).not.toContain("비활성 항목");
    expect(unmet.map((u) => u.label)).not.toContain("제안서 발송");
  });
});
