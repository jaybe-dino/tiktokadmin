import { describe, expect, it } from "vitest";
import { emailDomain } from "../lib/email-sync";
import { nextStepGuide } from "../lib/meetings";
import { makeBrand } from "./factory";
import type { GateContext } from "../lib/gates";

describe("emailDomain", () => {
  it("주소에서 도메인 추출(소문자)", () => {
    expect(emailDomain("Foo@Brand.co.KR")).toBe("brand.co.kr");
    expect(emailDomain(" a@b.com ")).toBe("b.com");
    expect(emailDomain("noat")).toBeNull();
  });
});

function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    brand: makeBrand(),
    hasMeetingNote: false, hasDiagnosis: false, paymentConfirmed: false,
    docTemplateCreated: false, allDocsDone: false, hasFirstPerformance: false,
    hasSentProposal: false, hasPreSurvey: false, ...over,
  };
}

describe("nextStepGuide (게이트 재사용)", () => {
  it("meeting → contact 체크리스트: 영업담당/사전학습설문 (등급 요건 제거)", async () => {
    const brand = makeBrand({ state: "meeting" });
    const guide = await nextStepGuide(brand, ctx({ brand }));
    expect(guide?.to).toBe("contact");
    const labels = guide!.items.map((i) => i.label);
    // 영업담당·사전학습설문은 요건, 사전분석(등급)은 제거됨.
    expect(labels.some((l) => l.includes("영업담당"))).toBe(true);
    expect(labels.some((l) => l.includes("사전학습"))).toBe(true);
    expect(labels.some((l) => l.includes("사전분석(등급)"))).toBe(false);
    // 사전학습 설문 발송 시 해당 항목 자동 충족.
    const guide2 = await nextStepGuide(brand, ctx({ brand, hasPreSurvey: true }));
    const item = guide2!.items.find((i) => i.label.includes("사전학습"));
    expect(item?.done).toBe(true);
  });
});
