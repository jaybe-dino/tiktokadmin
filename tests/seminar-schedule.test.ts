// 주간 세미나 — 회차·모집 구간·중복 키·문구 치환의 순수 계산.
import { describe, it, expect } from "vitest";
import {
  buildSession, nextSessionDate, inWindow, isLate, latePlan, dedupeKeys,
  normEmail, normPhone, renderTemplate, sessionLabel, sendBlockers, isHttpUrl,
  atKst, kstDay, shiftDay, fromKst,
  type SeminarScheduleConfig,
} from "../lib/seminar-schedule";

// 월요일 10:30 / 2차 11:10 / 안내는 회차 당일 09:00 / 접수 마감 30분 전
const base: SeminarScheduleConfig = {
  weekMode: "session_to_session",
  sessionWeekday: 1, sessionHour: 10, sessionMinute: 30,
  followupHour: 11, followupMinute: 10,
  noticeLeadDays: 0, noticeHour: 9, noticeMinute: 0,
  cutoffMinutes: 30,
};
const calendar: SeminarScheduleConfig = { ...base, weekMode: "calendar_week" };

describe("KST 변환", () => {
  it("KST 벽시계를 UTC 인스턴트로 바꾼다", () => {
    // 2026-10-05 10:30 KST = 2026-10-05 01:30Z
    expect(atKst("2026-10-05", 10, 30).toISOString()).toBe("2026-10-05T01:30:00.000Z");
    expect(fromKst(2026, 10, 5, 0, 0).toISOString()).toBe("2026-10-04T15:00:00.000Z");
  });
  it("UTC 인스턴트를 KST 날짜로 읽는다 — 자정 근처에서 날이 밀리지 않는다", () => {
    expect(kstDay(new Date("2026-10-04T15:00:00.000Z"))).toBe("2026-10-05");
    expect(kstDay(new Date("2026-10-04T14:59:59.000Z"))).toBe("2026-10-04");
  });
  it("날짜 이동이 월을 넘어간다", () => {
    expect(shiftDay("2026-10-05", -7)).toBe("2026-09-28");
    expect(shiftDay("2026-09-28", 7)).toBe("2026-10-05");
  });
});

describe("다음 회차", () => {
  it("회차 시작 직전이면 그날, 직후면 다음 주", () => {
    expect(nextSessionDate(new Date("2026-10-05T01:29:00Z"), base)).toBe("2026-10-05");
    expect(nextSessionDate(new Date("2026-10-05T01:31:00Z"), base)).toBe("2026-10-12");
  });
  it("주중 아무 날에서도 다음 월요일을 찾는다", () => {
    // 2026-09-30 은 수요일
    expect(nextSessionDate(new Date("2026-09-30T00:00:00Z"), base)).toBe("2026-10-05");
    expect(nextSessionDate(new Date("2026-10-08T00:00:00Z"), base)).toBe("2026-10-12");
  });
});

describe("주간 경계 A · 회차→회차", () => {
  const s = buildSession("2026-10-12", base);
  it("지난 회차 접수마감 ~ 이번 회차 접수마감", () => {
    expect(s.startsAt.toISOString()).toBe("2026-10-12T01:30:00.000Z");
    expect(s.followupAt.toISOString()).toBe("2026-10-12T02:10:00.000Z");
    expect(s.windowTo.toISOString()).toBe("2026-10-12T01:00:00.000Z");   // 10:00 KST (30분 전)
    expect(s.windowFrom.toISOString()).toBe("2026-10-05T01:00:00.000Z"); // 지난 월 10:00 KST
  });
  it("구간 끝은 열린 구간이라 경계값이 두 회차에 겹치지 않는다", () => {
    const prev = buildSession("2026-10-05", base);
    const edge = new Date("2026-10-05T01:00:00.000Z");
    expect(inWindow(edge, prev)).toBe(false);
    expect(inWindow(edge, s)).toBe(true);
  });
  it("회차끼리 구간이 맞닿아 빠지는 신청이 없다", () => {
    const prev = buildSession("2026-10-05", base);
    expect(prev.windowTo.getTime()).toBe(s.windowFrom.getTime());
  });
  it("접수 마감 이후 신청은 이번 회차가 아니다", () => {
    expect(inWindow(new Date("2026-10-12T01:15:00Z"), s)).toBe(false);  // 10:15 KST
  });
});

describe("주간 경계 B · 달력 주", () => {
  const s = buildSession("2026-10-12", calendar);
  it("지난 월 00:00 ~ 일 23:59:59(KST)", () => {
    expect(s.windowFrom.toISOString()).toBe("2026-10-04T15:00:00.000Z"); // 10-05 00:00 KST
    expect(s.windowTo.toISOString()).toBe("2026-10-11T15:00:00.000Z");   // 10-12 00:00 KST
  });
  it("일요일 23:59 은 포함, 월요일 00:00 은 다음 회차", () => {
    expect(inWindow(atKst("2026-10-11", 23, 59), s)).toBe(true);
    expect(inWindow(atKst("2026-10-12", 0, 0), s)).toBe(false);
  });
  it("두 방식은 같은 신청을 서로 다른 회차로 보낼 수 있다(그래서 설정으로 고른다)", () => {
    const applied = atKst("2026-10-12", 9, 0);     // 회차 당일 오전 9시 신청
    expect(inWindow(applied, buildSession("2026-10-12", base))).toBe(true);
    expect(inWindow(applied, buildSession("2026-10-12", calendar))).toBe(false);
    expect(inWindow(applied, buildSession("2026-10-19", calendar))).toBe(true);
  });
});

describe("늦은 신청", () => {
  const s = buildSession("2026-10-12", base);   // 안내 예정 09:00 KST
  it("안내 예정 시각 이후 신청만 늦은 신청이다", () => {
    expect(isLate(atKst("2026-10-12", 8, 59), s)).toBe(false);
    expect(isLate(atKst("2026-10-12", 9, 1), s)).toBe(true);
  });
  it("send_now 는 회차 시작 전까지만 즉시 안내한다", () => {
    expect(latePlan("send_now", atKst("2026-10-12", 10, 0), s).action).toBe("send_now");
    // 회차가 이미 시작했으면 지난 안내를 보내지 않고 다음 회차로 넘긴다
    expect(latePlan("send_now", atKst("2026-10-12", 10, 31), s).action).toBe("defer");
  });
  it("next_week 는 이월, skip 은 제외", () => {
    expect(latePlan("next_week", atKst("2026-10-12", 9, 30), s).action).toBe("defer");
    expect(latePlan("skip", atKst("2026-10-12", 9, 30), s).action).toBe("skip");
  });
});

describe("연락처 정규화·중복 키", () => {
  it("이메일은 공백·대소문자를 무시한다", () => {
    expect(normEmail("  A@B.COM ")).toBe("a@b.com");
    expect(normEmail(null)).toBe("");
  });
  it("전화는 표기가 달라도 같은 값이 된다", () => {
    expect(normPhone("010-4687-1461")).toBe("01046871461");
    expect(normPhone("+82 10-4687-1461")).toBe("01046871461");
    expect(normPhone("821046871461")).toBe("01046871461");
    expect(normPhone("")).toBe("");
  });
  it("연락처 기준은 이메일·전화 둘 다 키가 된다(한쪽만 겹쳐도 중복)", () => {
    const k = dedupeKeys("contact", { brandId: "b1", email: "A@b.com", phone: "010-1111-2222" });
    expect(k).toEqual(["e:a@b.com", "p:01011112222"]);
  });
  it("팀 기준은 브랜드 하나만 키가 된다", () => {
    expect(dedupeKeys("brand", { brandId: "b1", email: "a@b.com", phone: "01011112222" })).toEqual(["b:b1"]);
  });
  it("연락처가 없으면 키도 없다", () => {
    expect(dedupeKeys("contact", { brandId: "b1", email: "", phone: "" })).toEqual([]);
  });
});

describe("문구", () => {
  const vars = { 브랜드명: "테스트", 담당자명: "홍길동", 일시: "2026년 10월 5일(월) 오전 10:30", 줌링크: "https://z/1", 세미나명: "GloveK 온라인 세미나" };
  it("치환이 되고 남는 자리표시자가 없다", () => {
    const out = renderTemplate("{{담당자명}}님 — {{세미나명}} {{일시}} {{줌링크}} {{없는키}}", vars);
    expect(out).toBe("홍길동님 — GloveK 온라인 세미나 2026년 10월 5일(월) 오전 10:30 https://z/1 ");
    expect(out).not.toContain("{{");
  });
  it("회차 시각을 KST 로 표기한다", () => {
    expect(sessionLabel(atKst("2026-10-05", 10, 30))).toBe("2026년 10월 5일(월) 오전 10:30");
    expect(sessionLabel(atKst("2026-10-05", 11, 10))).toBe("2026년 10월 5일(월) 오전 11:10");
  });
});

describe("발송 차단", () => {
  const ok = {
    enabled: true, zoomUrl: "https://us06web.zoom.us/j/1", masterChannel: true,
    template: { enabled: true, body: "본문", subject: "제목", channelOn: true },
    stage: "notice" as const, channel: "email" as const,
  };
  it("모두 갖춰지면 막지 않는다", () => {
    expect(sendBlockers(ok)).toEqual([]);
  });
  it("Zoom 링크가 없으면 어떤 경우에도 막는다", () => {
    expect(sendBlockers({ ...ok, zoomUrl: "" }).join()).toContain("Zoom");
    expect(sendBlockers({ ...ok, zoomUrl: "미정" }).join()).toContain("Zoom");
  });
  it("마스터 OFF · 문구 초안 · 채널 OFF · 빈 본문 · 빈 제목을 각각 막는다", () => {
    expect(sendBlockers({ ...ok, enabled: false }).join()).toContain("마스터");
    expect(sendBlockers({ ...ok, template: { ...ok.template, enabled: false } }).join()).toContain("초안");
    expect(sendBlockers({ ...ok, masterChannel: false }).join()).toContain("채널");
    expect(sendBlockers({ ...ok, template: { ...ok.template, body: "  " } }).join()).toContain("본문");
    expect(sendBlockers({ ...ok, template: { ...ok.template, subject: "" } }).join()).toContain("제목");
  });
  it("문자에는 메일 제목을 요구하지 않는다", () => {
    expect(sendBlockers({ ...ok, channel: "sms", template: { ...ok.template, subject: "" } })).toEqual([]);
  });
  it("링크 형식을 검사한다", () => {
    expect(isHttpUrl("https://us06web.zoom.us/j/1?pwd=x")).toBe(true);
    expect(isHttpUrl("zoom.us/j/1")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});
