import { describe, it, expect } from "vitest";
import { parseBudgetWon, parseCountry, looksLikeCaution } from "../lib/mkt-proposal2";

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

  it("looksLikeCaution: 화장품 법정 주의사항 상용구는 걸러내고, 실제 특징 문구는 통과", () => {
    expect(looksLikeCaution(
      "화장품 사용 시 또는 사용 후 직사광선에 의하여 사용 부위가 붉은 반점, 부어오름 또는 가려움증 등의 이상 " +
      "증상이나 부작용이 있는 경우 전문의 등과 상담할 것. 보관 및 취급 시의 주의사항 어린이의 손이 닿지 않는 곳에 보관할 것",
    )).toBe(true);
    expect(looksLikeCaution("비타민C와 나이아신아마이드로 미백·항노화 이중 케어, 산뜻한 사용감")).toBe(false);
    expect(looksLikeCaution("")).toBe(false);
  });
});
