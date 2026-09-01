import { describe, it, expect } from "vitest";
import { addMonths, currentYM, monthWindow, rangeFromSelection, inRange, ymKey } from "../lib/month-window";

describe("month-window (제안서 기간 선택)", () => {
  it("연말을 넘겨도 연도가 정확히 증가", () => {
    expect(addMonths({ year: 2026, month: 11 }, 3)).toEqual({ year: 2027, month: 2 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(ymKey({ year: 2026, month: 3 })).toBe("2026-03");
  });

  it("전체 월 창 — 기준 연월부터 12개월 연속", () => {
    const win = monthWindow({ year: 2026, month: 9 }, 12);
    expect(win.length).toBe(12);
    expect(win[0]).toEqual({ year: 2026, month: 9 });
    expect(win[3]).toEqual({ year: 2026, month: 12 });
    expect(win[4]).toEqual({ year: 2027, month: 1 });   // 해를 넘어감
    expect(win[11]).toEqual({ year: 2027, month: 8 });  // 3~8월도 창에 포함
  });

  it("다음 달/다다음 달 기준 계산", () => {
    const base = new Date(2026, 8, 15); // 2026-09
    expect(currentYM(base, 1)).toEqual({ year: 2026, month: 10 });
    expect(currentYM(base, 2)).toEqual({ year: 2026, month: 11 });
  });

  it("9월을 빼고 10월부터 6개월 선택 → 10월 시작 6개월", () => {
    const sel = [10, 11, 12].map((m) => ({ year: 2026, month: m }))
      .concat([1, 2, 3].map((m) => ({ year: 2027, month: m })));
    expect(rangeFromSelection(sel)).toEqual({ start: { year: 2026, month: 10 }, months: 6 });
  });

  it("중간이 비어도 처음~마지막 구간으로 메운다(엔진은 건너뛸 수 없음)", () => {
    const sel = [{ year: 2026, month: 10 }, { year: 2027, month: 1 }];
    expect(rangeFromSelection(sel)).toEqual({ start: { year: 2026, month: 10 }, months: 4 });
  });

  it("선택 없음 → null", () => {
    expect(rangeFromSelection([])).toBeNull();
  });

  it("inRange — 구간 판정(해 넘김 포함)", () => {
    const start = { year: 2026, month: 11 };
    expect(inRange({ year: 2026, month: 11 }, start, 4)).toBe(true);
    expect(inRange({ year: 2027, month: 2 }, start, 4)).toBe(true);
    expect(inRange({ year: 2027, month: 3 }, start, 4)).toBe(false);
    expect(inRange({ year: 2026, month: 10 }, start, 4)).toBe(false);
  });
});
