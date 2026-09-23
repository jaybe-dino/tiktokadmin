// 신규 리드 연속 안내 — 키(유입 소스)별 회차: 유입 1일차 → 2일차 …
//   유입 즉시 발송은 기존 1회성 자동안내가 담당하므로 여기엔 없다(같은 순간 이중 발송 방지).
import { describe, it, expect } from "vitest";
import {
  kstSlot, planSchedule, defaultSeqConfig, dayLabel, type SeqConfig,
} from "../lib/lead-sequence-plan";

// 키마다 설정이 따로 — 테스트는 메타 광고 키를 기준으로 한다.
const base: SeqConfig = { ...defaultSeqConfig("ch-meta"), enabled: true, days: 5, hour: 10 };
const kstText = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });

describe("회차 이름", () => {
  it("회차는 유입 N일차", () => {
    expect(dayLabel(1)).toBe("유입 1일차");
    expect(dayLabel(5)).toBe("유입 5일차");
  });
});

describe("kstSlot (한국시간 지정 시각)", () => {
  it("KST 10시는 UTC 01시", () => {
    const slot = kstSlot(new Date("2026-09-22T05:00:00Z"), 0, 10);  // KST 22일 14:00
    expect(slot.toISOString()).toBe("2026-09-22T01:00:00.000Z");
    expect(kstText(slot)).toBe("2026-09-22 10:00:00");
  });
  it("UTC 기준 전날이어도 한국 날짜로 계산한다", () => {
    expect(kstText(kstSlot(new Date("2026-09-22T16:00:00Z"), 0, 10))).toBe("2026-09-23 10:00:00");
  });
});

describe("planSchedule (유입 N일차)", () => {
  const from = new Date("2026-09-22T05:00:00Z");   // KST 22일(화) 14:00

  it("1~5일차 = 5회차 — 유입 당일(즉시) 회차는 없다", () => {
    const p = planSchedule(from, base);
    expect(p).toHaveLength(5);
    expect(p[0].day_no).toBe(1);
    expect(p[4].day_no).toBe(5);
    // 유입 시각에 걸리는 회차가 하나도 없어야 한다(기존 1회성 자동안내와 겹치지 않게).
    expect(p.some((x) => x.due_at.getTime() === from.getTime())).toBe(false);
  });
  it("N일차는 유입일로부터 N일 뒤 지정 시각", () => {
    const p = planSchedule(from, base);
    expect(kstText(p[0].due_at)).toBe("2026-09-23 10:00:00");   // 1일차
    expect(kstText(p[1].due_at)).toBe("2026-09-24 10:00:00");   // 2일차
    expect(kstText(p[4].due_at)).toBe("2026-09-27 10:00:00");   // 5일차
  });
  it("유입이 이른 시각이어도 1일차는 유입 다음 날", () => {
    const early = new Date("2026-09-21T23:00:00Z");             // KST 22일 08:00(10시 전)
    const p = planSchedule(early, base);
    expect(kstText(p[0].due_at)).toBe("2026-09-23 10:00:00");
  });
  it("회차마다 다른 시각을 지정할 수 있다", () => {
    const p = planSchedule(from, { ...base, hourByDay: { 1: 9, 2: null, 3: 18 } });
    expect(kstText(p[0].due_at)).toBe("2026-09-23 09:00:00");
    expect(kstText(p[1].due_at)).toBe("2026-09-24 10:00:00");   // null → 기본 시각
    expect(kstText(p[2].due_at)).toBe("2026-09-25 18:00:00");
  });
  it("회차 범위는 1~30일차로 제한한다", () => {
    expect(planSchedule(from, { ...base, days: 99 })).toHaveLength(30);
    expect(planSchedule(from, { ...base, days: 0 })).toHaveLength(5);    // 잘못된 값 → 기본 5일차
  });
});

describe("키별 기본값", () => {
  it("설정하지 않은 키는 꺼진 상태 — 켠 키만 발송된다", () => {
    const c = defaultSeqConfig("ch-seminar");
    expect(c.channel_id).toBe("ch-seminar");
    expect(c.enabled).toBe(false);
    expect(c.days).toBe(5);
    expect(c.hour).toBe(10);
  });
  it("키마다 회차 범위·시각을 다르게 둘 수 있다", () => {
    const from = new Date("2026-09-22T05:00:00Z");
    const meta = planSchedule(from, { ...base, days: 5, hour: 10 });
    const seminar = planSchedule(from, { ...base, days: 3, hour: 14 });
    expect(meta).toHaveLength(5);
    expect(seminar).toHaveLength(3);
    expect(kstText(seminar[0].due_at)).toBe("2026-09-23 14:00:00");
  });
});
