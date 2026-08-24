import { describe, it, expect } from "vitest";
import { parseBudgetWon, parseCountry } from "../lib/mkt-proposal2";

describe("mkt-proposal2 설문 파싱(순수 함수)", () => {
  it("parseBudgetWon: 범위·억 단위·이상 표현에서 최댓값(원)", () => {
    expect(parseBudgetWon("500~1000만원")).toBe(10_000_000);
    expect(parseBudgetWon("1000만원 이상")).toBe(10_000_000);
    expect(parseBudgetWon("100만원 ~ 300만원")).toBe(3_000_000);
    expect(parseBudgetWon("1억 3,500만원 정도 검토 중")).toBe(135_000_000);
    expect(parseBudgetWon("아직 확정하지 않았습니다")).toBeNull();
    expect(parseBudgetWon("")).toBeNull();
  });

  it("parseCountry: 텍스트에서 먼저 언급된 국가를 코드로", () => {
    expect(parseCountry("미국 우선, 이후 확장")).toBe("US");
    expect(parseCountry("베트남·태국 우선 진출, 이후 미국 확장 검토")).toBe("VN");
    expect(parseCountry("아직 국가를 정하지 못했습니다")).toBeNull();
  });
});
