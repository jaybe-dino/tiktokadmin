// 입점 희망 국가 목록 — 서버(lib/onboarding)와 공개 신청서(app/apply) 사본이 어긋나지 않는지.
//   신청서는 "use client" 라 DB 를 가져오는 lib/onboarding 을 import 할 수 없어 사본을 둔다.
//   사본이 틀어지면 화면에만 있는 국가가 저장 때 이름 없이 들어간다 — 그걸 막는 시험이다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TIKTOK_COUNTRIES, CURRENCIES } from "../lib/onboarding";

const form = readFileSync(new URL("../app/apply/ApplyForm.tsx", import.meta.url), "utf8");

/** 신청서 파일에서 const 배열 한 줄을 그대로 읽어 평가한다. */
function constOf(name: string): unknown {
  const m = new RegExp(`const ${name}(?::[^=]+)? = (\\[.*?\\]);`, "s").exec(form);
  if (!m) throw new Error(`${name} 을 신청서에서 찾지 못했습니다.`);
  return JSON.parse(m[1]);
}

describe("입점 희망 국가", () => {
  it("일본이 들어 있다", () => {
    expect(TIKTOK_COUNTRIES).toContainEqual(["JP", "일본"]);
  });

  it("코드로 이름을 찾을 수 있다(저장 시 country_name 이 비지 않게)", () => {
    // lib/onboarding.saveCountries 가 이 조회로 country_name 을 채운다.
    for (const [code, name] of TIKTOK_COUNTRIES) {
      expect(TIKTOK_COUNTRIES.find(([c]) => c === code)?.[1], code).toBe(name);
      expect(name.trim(), code).not.toBe("");
    }
  });

  it("국가 코드가 중복되지 않는다", () => {
    const codes = TIKTOK_COUNTRIES.map(([c]) => c);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("공개 신청서의 사본이 서버 목록과 같다", () => {
    expect(constOf("COUNTRIES")).toEqual(TIKTOK_COUNTRIES);
  });
});

describe("통화", () => {
  it("일본 단가를 적을 수 있게 JPY 가 있다", () => {
    expect(CURRENCIES).toContain("JPY");
  });

  it("공개 신청서의 사본이 서버 목록과 같다", () => {
    expect(constOf("CURRENCIES")).toEqual(CURRENCIES);
  });
});
