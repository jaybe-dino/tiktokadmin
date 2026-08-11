import { describe, it, expect } from "vitest";
import { parseIcs } from "../lib/ics";
import { cleanMeetingTitle } from "../lib/meetings";

describe("cleanMeetingTitle", () => {
  it("제목 앞에 붙은 URL 제거", () => {
    expect(cleanMeetingTitle("https://dinostudio.kr/ 브랜드 상담")).toBe("브랜드 상담");
  });
  it("URL만 있으면 기본 제목", () => {
    expect(cleanMeetingTitle("https://dinostudio.kr/")).toBe("미팅 초대");
  });
  it("빈 값이면 기본 제목", () => {
    expect(cleanMeetingTitle("")).toBe("미팅 초대");
  });
  it("URL 없는 정상 제목은 그대로", () => {
    expect(cleanMeetingTitle("브랜드 킥오프 미팅")).toBe("브랜드 킥오프 미팅");
  });
});

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:abc-123@glovek",
  "SUMMARY:브랜드 킥오프 미팅",
  "DTSTART:20260810T010000Z",
  "LOCATION:https://zoom.us/j/123",
  "ORGANIZER;CN=담당자:mailto:cs@glovek.space",
  "ATTENDEE;CN=John Doe;ROLE=REQ-PARTICIPANT:mailto:john@brand.com",
  "ATTENDEE;CN=Jane:mailto:jane@brand.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  it("VEVENT 기본 필드 파싱", () => {
    const ev = parseIcs(SAMPLE)!;
    expect(ev.uid).toBe("abc-123@glovek");
    expect(ev.summary).toBe("브랜드 킥오프 미팅");
    expect(ev.startIso).toBe("2026-08-10T01:00:00.000Z");
    expect(ev.location).toBe("https://zoom.us/j/123");
    expect(ev.organizer?.email).toBe("cs@glovek.space");
    expect(ev.attendees.map((a) => a.email)).toEqual(["john@brand.com", "jane@brand.com"]);
    expect(ev.method).toBe("REQUEST");
  });

  it("KST(TZID) naive 시각은 -9h 보정", () => {
    const ics = "BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:m\r\nDTSTART;TZID=Asia/Seoul:20260810T090000\r\nEND:VEVENT";
    expect(parseIcs(ics)!.startIso).toBe("2026-08-10T00:00:00.000Z");
  });

  it("취소 초대 method=CANCEL", () => {
    const ics = "METHOD:CANCEL\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:m\r\nEND:VEVENT";
    expect(parseIcs(ics)!.method).toBe("CANCEL");
  });

  it("VEVENT 없으면 null", () => {
    expect(parseIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toBeNull();
  });
});
