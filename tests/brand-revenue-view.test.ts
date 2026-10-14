import { describe, expect, it } from "vitest";
import { revenueAmount, revenueView } from "../lib/brand-revenue-view";
const valid = { status: "estimated", lower: 2e9, upper: 4e9, currency: "KRW", year: 2025, scope: "brand", entity: "검증용 브랜드", confidence: "low", estimated_at: "2026-10-15T09:00:00+09:00", rationale: "공개 자료에 따른 추정 범위", sources: [{ title: "공개 자료", url: "https://example.com/revenue" }] };
describe("revenue display must not invent or misstate financial figures", () => {
  it("does not treat missing/failed/pending results as zero", () => {
    for (const raw of [undefined, null, {}, { status: "failed" }, { status: "pending" }]) expect(revenueView(raw).estimate).toBeNull();
  });
  it("requires evidence, sane bounds and a supported currency", () => {
    for (const patch of [{ sources: [] }, { lower: -1 }, { lower: 5e9 }, { upper: Infinity }, { currency: "?" }, { year: 2099 }, { scope: "unknown" }, { sources: [{ title: "bad", url: "javascript:alert(1)" }] }]) {
      expect(revenueView({ ...valid, ...patch }).estimate).toBeNull();
    }
  });
  it("keeps annual period, company scope, confidence and sources", () => {
    const e = revenueView({ ...valid, scope: "company_consolidated" }).estimate!;
    expect(e.year).toBe(2025); expect(e.scope).toBe("company_consolidated"); expect(e.confidence).toBe("low"); expect(e.sources).toHaveLength(1);
    expect(revenueView(valid).label).toContain("미확정");
  });
  it("does not mislabel foreign currencies as won", () => {
    expect(revenueAmount(2e9, "KRW")).toBe("20억 원");
    expect(revenueAmount(150000, "USD")).toBe("150,000 USD");
  });
});
