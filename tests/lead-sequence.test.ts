// 신규 리드 연속 안내 — 예정 시각 계산(한국시간 기준).
import { describe, it, expect } from "vitest";
import { kstSlot, shiftWeekend, planSchedule, defaultSeqConfig, type SeqConfig } from "../lib/lead-sequence";

// 유입 루트(소스)마다 설정이 따로 — 테스트는 메타 광고 루트를 기준으로 한다.
const base: SeqConfig = { ...defaultSeqConfig("meta_ads"), enabled: true, days: 7, hour: 10 };
// KST 는 UTC+9 → KST 10:00 = UTC 01:00 (같은 날)
const kstText = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });

describe("kstSlot (한국시간 지정 시각)", () => {
  it("KST 10시는 UTC 01시", () => {
    // 2026-09-22T05:00Z = KST 22일 14:00
    const slot = kstSlot(new Date("2026-09-22T05:00:00Z"), 0, 10);
    expect(slot.toISOString()).toBe("2026-09-22T01:00:00.000Z");
    expect(kstText(slot)).toBe("2026-09-22 10:00:00");
  });
  it("날짜가 바뀌는 시각(UTC 기준 전날)에도 한국 날짜로 계산한다", () => {
    // 2026-09-22T16:00Z = KST 23일 01:00 → 당일(23일) 10시여야 한다
    const slot = kstSlot(new Date("2026-09-22T16:00:00Z"), 0, 10);
    expect(kstText(slot)).toBe("2026-09-23 10:00:00");
  });
  it("offsetDays 만큼 다음 날로 민다", () => {
    expect(kstText(kstSlot(new Date("2026-09-22T05:00:00Z"), 3, 10))).toBe("2026-09-25 10:00:00");
  });
});

describe("shiftWeekend (주말 건너뛰기)", () => {
  it("토요일 → 월요일", () => {
    const sat = kstSlot(new Date("2026-09-26T05:00:00Z"), 0, 10); // 2026-09-26 은 토요일
    expect(kstText(shiftWeekend(sat))).toBe("2026-09-28 10:00:00");
  });
  it("일요일 → 월요일", () => {
    const sun = kstSlot(new Date("2026-09-27T05:00:00Z"), 0, 10);
    expect(kstText(shiftWeekend(sun))).toBe("2026-09-28 10:00:00");
  });
  it("평일은 그대로", () => {
    const tue = kstSlot(new Date("2026-09-22T05:00:00Z"), 0, 10);
    expect(shiftWeekend(tue).getTime()).toBe(tue.getTime());
  });
});

describe("planSchedule (7일 예정표)", () => {
  it("1일차 즉시 + 2일차부터 매일 10시", () => {
    const from = new Date("2026-09-22T05:00:00Z");  // KST 22일 14:00 — 오늘 10시는 이미 지남
    const p = planSchedule(from, base);
    expect(p).toHaveLength(7);
    expect(p[0].due_at.getTime()).toBe(from.getTime());          // 즉시
    expect(kstText(p[1].due_at)).toBe("2026-09-23 10:00:00");    // 다음 날 10시
    expect(kstText(p[6].due_at)).toBe("2026-09-28 10:00:00");
  });
  it("유입이 10시 전이면 1일차도 당일 10시(즉시 끄기)", () => {
    const from = new Date("2026-09-21T23:00:00Z"); // KST 22일 08:00
    const p = planSchedule(from, { ...base, day1Immediate: false });
    expect(kstText(p[0].due_at)).toBe("2026-09-22 10:00:00");
    expect(kstText(p[1].due_at)).toBe("2026-09-23 10:00:00");
  });
  it("유입이 10시 후면 1일차는 다음 날 10시(즉시 끄기)", () => {
    const from = new Date("2026-09-22T05:00:00Z"); // KST 22일 14:00
    const p = planSchedule(from, { ...base, day1Immediate: false });
    expect(kstText(p[0].due_at)).toBe("2026-09-23 10:00:00");
  });
  it("주말 건너뛰기를 켜면 토·일 예정이 월요일로 밀린다", () => {
    const from = new Date("2026-09-24T05:00:00Z"); // KST 24일(목) 14:00
    const p = planSchedule(from, { ...base, skipWeekend: true });
    const days = p.map((x) => kstText(x.due_at).slice(0, 10));
    expect(days).not.toContain("2026-09-26"); // 토
    expect(days).not.toContain("2026-09-27"); // 일
  });
  it("기간은 1~30일로 제한한다", () => {
    expect(planSchedule(new Date(), { ...base, days: 99 })).toHaveLength(30);
    expect(planSchedule(new Date(), { ...base, days: 0 })).toHaveLength(7);
  });
});

describe("defaultSeqConfig (루트별 기본값)", () => {
  it("설정하지 않은 유입 루트는 꺼진 상태 — 켠 루트만 발송된다", () => {
    const c = defaultSeqConfig("expo_popup");
    expect(c.source_key).toBe("expo_popup");
    expect(c.enabled).toBe(false);
    expect(c.days).toBe(7);
    expect(c.hour).toBe(10);
  });
  it("루트마다 기간·시각을 다르게 둘 수 있다", () => {
    const meta = planSchedule(new Date("2026-09-22T05:00:00Z"), { ...base, days: 7, hour: 10 });
    const expo = planSchedule(new Date("2026-09-22T05:00:00Z"), { ...base, days: 3, hour: 14 });
    expect(meta).toHaveLength(7);
    expect(expo).toHaveLength(3);
    expect(expo[1].due_at.toISOString()).toBe("2026-09-23T05:00:00.000Z"); // KST 14시
  });
});
