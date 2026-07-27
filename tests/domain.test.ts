import { describe, expect, it } from "vitest";
import { countChecks, gradeFromChecks, gradeFromCount, recommendedTrack } from "../lib/grade";
import { extractKeys, normalizeBizNo, normalizeEmail, normalizePhone, urlHost } from "../lib/dedup";
import { canTerminate, isAhead, isTransitionAllowed, ownerFieldForState } from "../lib/states";
import { evaluateGate, type GateContext } from "../lib/gates";
import { businessDaysBetween, mondayOfWeekKst } from "../lib/time";
import { checkSlaBreach, tierFromDaysOver } from "../lib/sla";
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
    expect(isTransitionAllowed("lead_new", "meeting").allowed).toBe(true);
    expect(isTransitionAllowed("contact", "contract_done").allowed).toBe(true);
    expect(isTransitionAllowed("setup", "live_mall").allowed).toBe(true);
  });
  it("허용되지 않은 점프 거부", () => {
    expect(isTransitionAllowed("lead_new", "docs").allowed).toBe(false);
    expect(isTransitionAllowed("meeting", "contract_done").allowed).toBe(false);
  });
  it("후퇴는 lead/exec 만", () => {
    expect(isTransitionAllowed("contact", "meeting", "sales").allowed).toBe(false);
    expect(isTransitionAllowed("contact", "meeting", "lead").allowed).toBe(true);
    expect(isTransitionAllowed("contact", "meeting", "exec").allowed).toBe(true);
  });
  it("dropped 는 어디서든, churned 는 live*/settling 만", () => {
    expect(canTerminate("lead_new", "dropped")).toBe(true);
    expect(canTerminate("lead_new", "churned")).toBe(false);
    expect(canTerminate("live_mall", "churned")).toBe(true);
    expect(canTerminate("settling", "churned")).toBe(true);
  });
  it("isAhead 퍼널 서열", () => {
    expect(isAhead("contact", "lead_new")).toBe(true);
    expect(isAhead("lead_new", "contact")).toBe(false);
  });
  it("담당 필드 매핑", () => {
    expect(ownerFieldForState("meeting")).toBe("owner_intake");
    expect(ownerFieldForState("contact")).toBe("owner_sales");
    expect(ownerFieldForState("docs")).toBe("owner_onboard");
    expect(ownerFieldForState("live_mall")).toBe("owner_ads");
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
    expect(evaluateGate("lead_new", "seminar", ctx()).passed).toBe(true);
  });
  it("meeting→contact: 회의록·영업담당·등급 필요", () => {
    const bad = evaluateGate("meeting", "contact", ctx());
    expect(bad.passed).toBe(false);
    expect(bad.failed.map((f) => f.label)).toContain("회의록 없음");
    expect(bad.failed.map((f) => f.label)).toContain("사전분석(등급) 없음");

    const good = evaluateGate(
      "meeting",
      "contact",
      ctx({
        brand: makeBrand({ owner_sales: "sales@x.com", grade: "A" }),
        hasMeetingNote: true,
        hasDiagnosis: true,
      }),
    );
    expect(good.passed).toBe(true);
  });
  it("contact→contract_done: 결제 확인 필요", () => {
    const b = makeBrand({ contract_type: "mall", plan: "live_focus_490k" });
    expect(evaluateGate("contact", "contract_done", ctx({ brand: b })).passed).toBe(false);
    expect(
      evaluateGate("contact", "contract_done", ctx({ brand: b, paymentConfirmed: true })).passed,
    ).toBe(true);
  });
  it("docs→setup: 서류 100% + 사업자번호", () => {
    const b = makeBrand({ biz_no: "1234567890" });
    expect(evaluateGate("docs", "setup", ctx({ brand: b })).passed).toBe(false);
    expect(evaluateGate("docs", "setup", ctx({ brand: b, allDocsDone: true })).passed).toBe(true);
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
  it("checkSlaBreach: lead_new 2일 초과 시 위반", () => {
    const policies = { lead_new: 2 };
    const b = makeBrand({ state: "lead_new", stage_entered_at: "2026-07-20T00:00:00Z" });
    const now = new Date("2026-07-27T00:00:00Z"); // 월(20)~월(27), 주말2 제외 5영업일
    const breach = checkSlaBreach(b, policies, now);
    expect(breach).not.toBeNull();
    expect(breach!.daysOver).toBeGreaterThan(0);
  });
  it("mondayOfWeekKst 반환 형식", () => {
    expect(mondayOfWeekKst(new Date("2026-07-29T05:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
