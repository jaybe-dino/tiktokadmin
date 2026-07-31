import { describe, expect, it } from "vitest";
import { isMarketingKind } from "../lib/lifecycle";

describe("수신동의 게이팅 (17 §5)", () => {
  it("광고성 kind 판정", () => {
    expect(isMarketingKind("reactivation")).toBe(true);
    expect(isMarketingKind("upsell")).toBe(true);
    expect(isMarketingKind("newsletter")).toBe(true);
    expect(isMarketingKind("bulk_email")).toBe(true);
  });
  it("거래성 kind 는 동의 무관(false)", () => {
    expect(isMarketingKind("followup")).toBe(false);
    expect(isMarketingKind("payment_notice")).toBe(false);
    expect(isMarketingKind("reply")).toBe(false);
    expect(isMarketingKind("reminder")).toBe(false);
  });
});
