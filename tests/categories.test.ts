import { describe, it, expect } from "vitest";
import { joinCategory, splitCategory, categorySearchTerms, categoryTermTiers, PRODUCT_CATEGORIES } from "../lib/categories";

describe("categories (제품 카테고리 대분류>소분류)", () => {
  it("join/split 왕복", () => {
    expect(joinCategory("스킨케어", "크림")).toBe("스킨케어 > 크림");
    expect(joinCategory("스킨케어")).toBe("스킨케어");
    expect(joinCategory("")).toBe("");
    expect(splitCategory("스킨케어 > 크림")).toEqual({ main: "스킨케어", sub: "크림" });
    expect(splitCategory("스킨케어")).toEqual({ main: "스킨케어", sub: "" });
    expect(splitCategory("")).toEqual({ main: "", sub: "" });
    expect(splitCategory(null)).toEqual({ main: "", sub: "" });
  });

  it("검색어 우선순위 — 소분류 먼저, 대분류 폴백", () => {
    expect(categorySearchTerms("스킨케어 > 크림")).toEqual(["크림", "스킨케어"]);
    expect(categorySearchTerms("스킨케어")).toEqual(["스킨케어"]);
    expect(categorySearchTerms("")).toEqual([]);
  });

  it("검색 티어 — '·' 분리 파트 + 영문 동의어 확장, 소분류→대분류 순", () => {
    const tiers = categoryTermTiers("스킨케어 > 세럼·앰플");
    expect(tiers).toHaveLength(2);
    // 소분류 티어: 원문 + 분리 파트 + 영문 동의어
    expect(tiers[0]).toContain("세럼·앰플");
    expect(tiers[0]).toContain("세럼");
    expect(tiers[0]).toContain("앰플");
    expect(tiers[0]).toContain("serum");
    // 대분류 티어(폴백)
    expect(tiers[1]).toContain("스킨케어");
    expect(tiers[1]).toContain("skincare");
    expect(categoryTermTiers("스킨케어")).toHaveLength(1);
    expect(categoryTermTiers("")).toHaveLength(0);
  });

  it("체계 무결성 — 대분류 중복 없음·소분류 존재", () => {
    const mains = PRODUCT_CATEGORIES.map((c) => c.main);
    expect(new Set(mains).size).toBe(mains.length);
    for (const c of PRODUCT_CATEGORIES) expect(c.subs.length).toBeGreaterThan(0);
  });
});
