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
    hasSentProposal: false, ...over,
  };
}

describe("nextStepGuide (게이트 재사용)", () => {
  it("meeting → contact 체크리스트: 회의록/담당/등급", async () => {
    const brand = makeBrand({ state: "meeting" });
    const guide = await nextStepGuide(brand, ctx({ brand }));
    expect(guide?.to).toBe("contact");
    const labels = guide!.items.map((i) => i.label);
    expect(labels.some((l) => l.includes("회의록"))).toBe(true);
    // 회의록 자동 충족 반영
    const guide2 = await nextStepGuide(brand, ctx({ brand, hasMeetingNote: true }));
    const note = guide2!.items.find((i) => i.label.includes("회의록"));
    expect(note?.done).toBe(true);
  });
});
