// Zoom 녹화·전사 수집 — 중복 이벤트, 늦은 전사, 반복회의, 브랜드 매핑, 원문 보존.
import { describe, it, expect } from "vitest";
import { parseVtt, vttToTranscript, vttSpeakers } from "../lib/zoom-vtt";
import { matchBrand, zoomIdFromUrl, BOOKING_WINDOW_HOURS, type BookingRow } from "../lib/zoom-match";
import { dedupeKey, TRANSCRIPT_FILE_TYPES, type ZoomEventPayload } from "../lib/zoom-ingest";
import { encodeMeetingUuid } from "../lib/zoom-api";

// ── 전사(VTT) 파싱 ───────────────────────────────────────────
const VTT = `WEBVTT

1
00:00:03.720 --> 00:00:08.250
김대표: 안녕하세요, 오늘 미팅 시작하겠습니다.

2
00:00:08.400 --> 00:00:12.100
김대표: 먼저 진행 상황부터 보겠습니다.

3
00:00:12.500 --> 00:00:16.000
Brand Lee: 네, 자료 공유드릴게요.
`;

describe("VTT 전사 파싱", () => {
  it("자막을 화자·내용으로 읽는다", () => {
    const cues = parseVtt(VTT);
    expect(cues).toHaveLength(3);
    expect(cues[0].speaker).toBe("김대표");
    expect(cues[0].text).toBe("안녕하세요, 오늘 미팅 시작하겠습니다.");
  });
  it("같은 화자의 연속 발화는 한 문단으로 합친다", () => {
    const t = vttToTranscript(VTT);
    expect(t.split("\n")).toHaveLength(2);
    expect(t).toContain("김대표: 안녕하세요, 오늘 미팅 시작하겠습니다. 먼저 진행 상황부터 보겠습니다.");
    expect(t).toContain("Brand Lee: 네, 자료 공유드릴게요.");
  });
  it("화자 목록을 뽑는다(참석자 보조 근거)", () => {
    expect(vttSpeakers(VTT)).toEqual(["김대표", "Brand Lee"]);
  });
  it("헤더·주석·빈 파일에 깨지지 않는다", () => {
    expect(vttToTranscript("")).toBe("");
    expect(vttToTranscript("WEBVTT\n\nNOTE 이건 주석\n")).toBe("");
    expect(parseVtt("그냥 텍스트")).toEqual([]);
  });
  it("화자 표기가 없는 자막도 본문으로 살린다", () => {
    const t = vttToTranscript("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n자막만 있는 줄\n");
    expect(t).toBe("자막만 있는 줄");
  });
});

// ── 중복 이벤트 ──────────────────────────────────────────────
const evt = (event: string, uuid: string, fileIds: string[] = []): ZoomEventPayload => ({
  event,
  payload: { object: { uuid, id: 81234567890, recording_files: fileIds.map((id) => ({ id })) } },
});

describe("중복 이벤트 방어", () => {
  it("같은 이벤트 재전송은 같은 키 — 한 번만 저장된다", () => {
    expect(dedupeKey(evt("recording.completed", "abc/uuid==", ["f1", "f2"])))
      .toBe(dedupeKey(evt("recording.completed", "abc/uuid==", ["f2", "f1"])));  // 파일 순서가 달라도 같은 키
  });
  it("녹화 완료와 전사 완료는 서로 다른 이벤트로 각각 처리된다", () => {
    expect(dedupeKey(evt("recording.completed", "u1", ["f1"])))
      .not.toBe(dedupeKey(evt("recording.transcript_completed", "u1", ["f1"])));
  });
  it("전사 파일이 추가로 온 이벤트는 별개로 본다(늦은 전사)", () => {
    expect(dedupeKey(evt("recording.completed", "u1", ["f1"])))
      .not.toBe(dedupeKey(evt("recording.completed", "u1", ["f1", "f2"])));
  });
  it("회의가 다르면 키가 다르다", () => {
    expect(dedupeKey(evt("recording.completed", "u1"))).not.toBe(dedupeKey(evt("recording.completed", "u2")));
  });
});

describe("전사 파일 식별", () => {
  it("TRANSCRIPT·CC 를 전사로 본다", () => {
    expect(TRANSCRIPT_FILE_TYPES.has("TRANSCRIPT")).toBe(true);
    expect(TRANSCRIPT_FILE_TYPES.has("CC")).toBe(true);
    expect(TRANSCRIPT_FILE_TYPES.has("MP4")).toBe(false);   // 녹화 파일은 전사가 아님
    expect(TRANSCRIPT_FILE_TYPES.has("TIMELINE")).toBe(false);
  });
});

describe("회의 UUID 인코딩", () => {
  it("/ 나 // 가 든 UUID 는 두 번 인코딩한다(Zoom 규칙)", () => {
    expect(encodeMeetingUuid("abc123==")).toBe("abc123%3D%3D");
    expect(encodeMeetingUuid("/ab//c==")).toBe(encodeURIComponent(encodeURIComponent("/ab//c==")));
  });
});

// ── 브랜드 매핑 ──────────────────────────────────────────────
const booking = (o: Partial<BookingRow>): BookingRow => ({
  id: "m1", brand_id: "brand-A", topic: "정기 미팅", scheduled_at: "2026-09-23T01:00:00Z",
  zoom_join_url: "https://us06web.zoom.us/j/81234567890?pwd=x", zoom_meeting_id: "manual", ...o,
});

describe("줌 링크에서 회의 ID", () => {
  it("참가 링크에서 숫자 ID 를 뽑는다", () => {
    expect(zoomIdFromUrl("https://us06web.zoom.us/j/81234567890?pwd=abc")).toBe("81234567890");
    expect(zoomIdFromUrl("https://zoom.us/my/room")).toBeNull();
    expect(zoomIdFromUrl(null)).toBeNull();
  });
});

describe("브랜드 매핑 우선순위", () => {
  it("예약에 남긴 명시적 연결을 최우선으로 쓴다", () => {
    const r = matchBrand({
      zoomMeetingId: "81234567890", startedAt: "2026-09-23T01:05:00Z",
      bookings: [booking({})], emailBrandIds: ["brand-Z"],   // 이메일 후보가 달라도 예약이 이긴다
    });
    expect(r.brandId).toBe("brand-A");
    expect(r.method).toBe("booking");
    expect(r.bookingMeetingId).toBe("m1");
  });

  it("반복 회의 — 숫자 회의 ID 만 같고 이번 회차 예약이 없으면 자동 연결하지 않는다", () => {
    const r = matchBrand({
      zoomMeetingId: "81234567890",
      startedAt: "2026-10-30T01:00:00Z",                    // 예약보다 한 달 뒤 회차
      bookings: [booking({})], emailBrandIds: [],
    });
    expect(r.brandId).toBeNull();
    expect(r.reason).toContain("반복 회의");
    expect(r.candidates).toHaveLength(1);                    // 후보로만 남긴다
  });

  it("허용 시간(±12시간) 안이면 같은 회차로 본다", () => {
    const within = matchBrand({
      zoomMeetingId: "81234567890",
      startedAt: `2026-09-23T${String(1 + BOOKING_WINDOW_HOURS - 1).padStart(2, "0")}:00:00Z`,
      bookings: [booking({})], emailBrandIds: [],
    });
    expect(within.method).toBe("booking");
  });

  it("같은 회의 ID 에 서로 다른 브랜드 예약이 있으면 확정하지 않는다", () => {
    const r = matchBrand({
      zoomMeetingId: "81234567890", startedAt: "2026-09-23T01:05:00Z",
      bookings: [booking({}), booking({ id: "m2", brand_id: "brand-B", scheduled_at: "2026-09-23T02:00:00Z" })],
      emailBrandIds: [],
    });
    expect(r.brandId).toBeNull();
    expect(r.candidates.map((c) => c.brand_id)).toEqual(["brand-A", "brand-B"]);
  });

  it("예약이 없으면 참석자 이메일을 보조 근거로 쓴다", () => {
    const r = matchBrand({ zoomMeetingId: "999", startedAt: "2026-09-23T01:00:00Z", bookings: [], emailBrandIds: ["brand-C", "brand-C"] });
    expect(r.brandId).toBe("brand-C");
    expect(r.method).toBe("email");
  });

  it("참석자가 여러 브랜드와 일치하면 미매핑으로 남긴다", () => {
    const r = matchBrand({ zoomMeetingId: null, startedAt: null, bookings: [], emailBrandIds: ["brand-C", "brand-D"] });
    expect(r.brandId).toBeNull();
    expect(r.candidates).toHaveLength(2);
  });

  it("근거가 없으면 제목만으로 확정하지 않는다", () => {
    const r = matchBrand({ zoomMeetingId: null, startedAt: null, bookings: [], emailBrandIds: [] });
    expect(r.brandId).toBeNull();
    expect(r.method).toBe("none");
    expect(r.reason).toContain("일치 없음");
  });

  it("브랜드가 지정되지 않은 예약은 매핑 근거로 쓰지 않는다", () => {
    const r = matchBrand({
      zoomMeetingId: "81234567890", startedAt: "2026-09-23T01:05:00Z",
      bookings: [booking({ brand_id: null })], emailBrandIds: [],
    });
    expect(r.brandId).toBeNull();
  });
});

// ── 원문 보존 · 재처리 안전 ──────────────────────────────────
import { keepExistingTranscript } from "../lib/zoom-ingest";

describe("원문 보존", () => {
  it("담당자가 직접 적은 회의록·전사는 자동 수집이 덮어쓰지 않는다", () => {
    expect(keepExistingTranscript({ transcript: "수기로 적은 회의 내용", transcript_source: "manual" })).toBe(true);
    expect(keepExistingTranscript({ transcript: "이전에 받은 전사", transcript_source: "zoom" })).toBe(true);
    expect(keepExistingTranscript({ transcript: "Whisper 전사", transcript_source: "whisper" })).toBe(true);
  });
  it("비어 있으면 새로 채운다", () => {
    expect(keepExistingTranscript({ transcript: "", transcript_source: "zoom" })).toBe(false);
    expect(keepExistingTranscript({ transcript: "   ", transcript_source: null })).toBe(false);
    expect(keepExistingTranscript(null)).toBe(false);
  });
  it("재수집 대상으로 표시한 건만 다시 받는다", () => {
    expect(keepExistingTranscript({ transcript: "잘못 들어온 값", transcript_source: "zoom_retry" })).toBe(false);
  });
});
