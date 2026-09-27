// PM 탭 입력 폼 회귀 — 날짜·시각 입력이 "state 만" 쓰면 저장에서 값이 빠진다.
//   값을 프로그램으로 넣으면 React change 이벤트가 뜨지 않아 state 가 빈 채로 남는다.
//   그래서 모든 날짜·시각 입력은 ref + defaultValue 로 두고, 제출 시점에 readVal 로 실제 값을 읽어야 한다.
//   (신규 등록 폼만 고치고 수정 폼을 빠뜨려 마감일이 저장되지 않은 일이 있었다.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/BrandPmPanel.tsx", import.meta.url), "utf8");
const lines = src.split("\n");

const dateInputLines = lines
  .map((text, i) => ({ text, line: i + 1 }))
  .filter((l) => /type="date"|type="datetime-local"/.test(l.text));

describe("날짜·시각 입력 배선", () => {
  it("날짜·시각 입력이 하나 이상 있다(감사 대상 존재 확인)", () => {
    expect(dateInputLines.length).toBeGreaterThanOrEqual(9);
  });

  it("모든 날짜·시각 입력에 ref 가 붙어 있다", () => {
    const missing = dateInputLines.filter((l) => !l.text.includes("ref={"));
    expect(missing.map((m) => `L${m.line}`)).toEqual([]);
  });

  it("모든 날짜·시각 입력이 defaultValue 를 쓴다(제어값만 쓰지 않는다)", () => {
    const bad = dateInputLines.filter((l) => !l.text.includes("defaultValue="));
    expect(bad.map((m) => `L${m.line}`)).toEqual([]);
  });

  it("날짜·시각 입력에 value={ 를 쓰지 않는다 — 이 배선이 저장 누락의 원인이었다", () => {
    const controlled = dateInputLines.filter((l) => /\svalue=\{/.test(l.text));
    expect(controlled.map((m) => `L${m.line}`)).toEqual([]);
  });

  it("각 날짜 ref 는 제출 시점에 readVal 로 읽힌다", () => {
    const refNames = [...src.matchAll(/ref=\{(\w+)\}/g)]
      .map((m) => m[1])
      .filter((name) => {
        // 그 ref 가 달린 줄이 날짜·시각 입력인지 확인
        return dateInputLines.some((l) => l.text.includes(`ref={${name}}`));
      });
    expect(refNames.length).toBeGreaterThanOrEqual(9);
    const unread = [...new Set(refNames)].filter((n) => !src.includes(`readVal(${n},`));
    expect(unread).toEqual([]);
  });

  it("필수값 검사가 버튼 disabled 가 아니라 제출 시 안내로 처리된다", () => {
    // disabled 에 필드 내용을 섞으면(예: !f.title.trim()) 프로그램 입력에서 영구 잠김이 된다.
    const badDisabled = lines
      .map((text, i) => ({ text, line: i + 1 }))
      .filter((l) => /disabled=\{[^}]*!f\./.test(l.text));
    expect(badDisabled.map((m) => `L${m.line}`)).toEqual([]);
  });

  it("조작 잠금은 조작별 busy 로만 한다(전역 useTransition 공유 금지)", () => {
    // 주석 언급은 괜찮지만 실제 호출·import 는 없어야 한다.
    expect(src).not.toMatch(/useTransition\s*\(/);
    expect(src).not.toMatch(/import\s*\{[^}]*useTransition/);
    expect(src).toContain("function useAction()");
  });
});
