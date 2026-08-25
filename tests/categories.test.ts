import { describe, it, expect } from "vitest";
import { joinCategory, splitCategory, categorySearchTerms, PRODUCT_CATEGORIES } from "../lib/categories";

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

  it("체계 무결성 — 대분류 중복 없음·소분류 존재", () => {
    const mains = PRODUCT_CATEGORIES.map((c) => c.main);
    expect(new Set(mains).size).toBe(mains.length);
    for (const c of PRODUCT_CATEGORIES) expect(c.subs.length).toBeGreaterThan(0);
  });
});
