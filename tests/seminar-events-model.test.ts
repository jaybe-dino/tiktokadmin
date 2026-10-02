// 세미나 모집 허브 — 순수 로직(DB 없이). 일시 표시·마스킹·노출항목·신청 차단 조건.
import { describe, it, expect } from "vitest";
import {
  EVENT_STATUSES, EVENT_STATUS_LABEL, EVENT_STATUS_TONE, PAST_STATUSES,
  EVENT_MODES, MODE_LABEL, isEventMode, isEventStatus,
  REG_STATUSES, REG_STATUS_LABEL, REG_OCCUPYING, isRegStatus,
  EMAIL_RE, cleanText, normEmail, normPhone, normSite, regDedupeKey,
  normSlug, isSlug, RESERVED_SLUGS, eventPath, applyPath, rosterPath, posterSrc,
  sniffImageMime, posterError, POSTER_MAX_BYTES,
  parseTs, kstParts, fmtKstDate, fmtKstTime, fmtKstDateTime, fmtWhen, fmtWhere,
  applyBlockers, seatsLeft,
  SHARE_FIELDS, SHARE_FIELD_KEYS, DEFAULT_SHARE_FIELDS, SHARE_NEVER_FIELDS,
  sanitizeShareFields, maskPhone, maskEmail,
  sharePwError, shareEnableBlockers, shareLive, SHARE_PW_MIN,
  csvCell, csvDoc, kstLocalToIso, isoToKstLocal,
  CONSENT_VERSION, PRIVACY_NOTICE, APPLY_NOT_CONFIRMED_NOTICE,
} from "../lib/seminar-events-model";

describe("상태 목록", () => {
  it("행사 상태는 전부 라벨과 색이 있다", () => {
    for (const s of EVENT_STATUSES) {
      expect(EVENT_STATUS_LABEL[s]).toBeTruthy();
      expect(EVENT_STATUS_TONE[s]).toBeTruthy();
    }
  });
  it("종료·취소만 지난 행사로 묶인다", () => {
    expect([...PAST_STATUSES]).toEqual(["done", "cancelled"]);
    expect(PAST_STATUSES).not.toContain("closed"); // 마감은 아직 열리기 전이다
  });
  it("진행 방식·신청자 상태도 라벨이 있다", () => {
    for (const m of EVENT_MODES) expect(MODE_LABEL[m]).toBeTruthy();
    for (const r of REG_STATUSES) expect(REG_STATUS_LABEL[r]).toBeTruthy();
  });
  it("신청 접수와 참석 확정은 다른 값이다", () => {
    expect(REG_STATUSES).toContain("applied");
    expect(REG_STATUSES).toContain("confirmed");
    expect(REG_STATUS_LABEL.applied).not.toBe(REG_STATUS_LABEL.confirmed);
  });
  it("정원에 드는 상태에서 취소·불참·대기는 빠진다", () => {
    expect([...REG_OCCUPYING]).toEqual(["applied", "confirmed", "attended"]);
    expect(REG_OCCUPYING).not.toContain("cancelled");
    expect(REG_OCCUPYING).not.toContain("noshow");
    expect(REG_OCCUPYING).not.toContain("waitlist");
  });
  it("타입 가드는 목록 밖의 값을 거른다", () => {
    expect(isEventStatus("open")).toBe(true);
    expect(isEventStatus("OPEN")).toBe(false);
    expect(isEventMode("hybrid")).toBe(true);
    expect(isEventMode("zoom")).toBe(false);
    expect(isRegStatus("attended")).toBe(true);
    expect(isRegStatus("")).toBe(false);
  });
});

describe("입력 정리", () => {
  it("이메일·전화를 정규화한다", () => {
    expect(normEmail(" JAY@Dino.KR ")).toBe("jay@dino.kr");
    expect(normPhone("010-1234-5678")).toBe("01012345678");
    expect(normPhone("+82 10 1234 5678")).toBe("821012345678");
  });
  it("제어문자를 지우고 길이를 자른다", () => {
    expect(cleanText("a\u0000b\nc")).toBe("a b c");
    expect(cleanText("가".repeat(50), 10)).toHaveLength(10);
  });
  it("이메일 형식 검사", () => {
    expect(EMAIL_RE.test("a@b.co")).toBe(true);
    expect(EMAIL_RE.test("a@b")).toBe(false);
    expect(EMAIL_RE.test("a b@c.kr")).toBe(false);
  });
  it("사이트는 비워도 통과하고, 적었으면 호스트 모양이어야 한다", () => {
    expect(normSite("")).toEqual({ ok: true, value: "" });
    expect(normSite("brand.co.kr").ok).toBe(true);
    expect(normSite("brand.co.kr").value).toMatch(/^https:\/\/brand\.co\.kr/);
    expect(normSite("http://localhost").ok).toBe(false);
    expect(normSite("그냥글자").ok).toBe(false);
  });
  it("같은 사람 판정값은 표기 차이를 흡수한다", () => {
    expect(regDedupeKey("A@B.kr", "010-1111-2222")).toBe(regDedupeKey("a@b.kr", "01011112222"));
    expect(regDedupeKey("a@b.kr", "01011112222")).not.toBe(regDedupeKey("a@b.kr", "01011112223"));
  });
});

describe("고정 URL(slug)", () => {
  it("빈칸·대문자·특수문자를 하이픈으로 정리한다", () => {
    expect(normSlug(" TikTok Shop 2026! ")).toBe("tiktok-shop-2026");
    expect(normSlug("---a---")).toBe("a");
  });
  it("하위 경로와 겹치는 이름은 쓰지 못한다", () => {
    for (const r of RESERVED_SLUGS) expect(isSlug(r)).toBe(false);
  });
  it("너무 짧거나 모양이 다르면 거른다", () => {
    expect(isSlug("ab")).toBe(false);
    expect(isSlug("abc")).toBe(true);
    expect(isSlug("-abc")).toBe(false);
    expect(isSlug("abc-")).toBe(false);
    expect(isSlug("Abc")).toBe(false);
    expect(isSlug("a".repeat(70))).toBe(false);
  });
  it("경로 조립", () => {
    expect(eventPath("x-y")).toBe("/events/x-y");
    expect(applyPath("x-y")).toBe("/events/x-y/apply");
    expect(rosterPath("deadbeef")).toBe("/roster/deadbeef");
    expect(posterSrc("f1")).toBe("/api/events/poster/f1");
  });
});

describe("포스터 검증", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

  it("내용으로 형식을 알아낸다", () => {
    expect(sniffImageMime(png)).toBe("image/png");
    expect(sniffImageMime(jpg)).toBe("image/jpeg");
    expect(sniffImageMime(webp)).toBe("image/webp");
    expect(sniffImageMime(pdf)).toBeNull();
  });
  it("확장자만 이미지인 파일은 막는다(내용이 PDF)", () => {
    expect(posterError("poster.png", 100, pdf)).toMatch(/이미지 파일이 아닙니다/);
  });
  it("확장자가 아니면 막는다", () => {
    expect(posterError("poster.pdf", 100, png)).toMatch(/PNG · JPG · WEBP/);
  });
  it("용량·빈 파일을 막는다", () => {
    expect(posterError("a.png", POSTER_MAX_BYTES + 1, png)).toMatch(/이하만/);
    expect(posterError("a.png", 0, png)).toMatch(/빈 파일/);
  });
  it("정상 이미지는 통과한다", () => {
    expect(posterError("a.jpg", 2048, jpg)).toBeNull();
    expect(posterError("a.WEBP", 2048, webp)).toBeNull();
  });
});

describe("일시 표시(KST)", () => {
  it("분이 없는 오프셋도 읽는다", () => {
    expect(parseTs("2026-10-06 13:00:00+09")?.toISOString()).toBe("2026-10-06T04:00:00.000Z");
    expect(parseTs("2026-10-06T04:00:00.000Z")?.toISOString()).toBe("2026-10-06T04:00:00.000Z");
    expect(parseTs("")).toBeNull();
    expect(parseTs("아무말")).toBeNull();
  });
  it("서버 타임존과 무관하게 KST 로 쪼갠다", () => {
    const k = kstParts("2026-10-06T04:00:00.000Z");
    expect(k).toMatchObject({ y: 2026, m: 10, d: 6, hh: 13, mm: 0, dow: "화" });
  });
  it("날짜·시각 포맷", () => {
    expect(fmtKstDate("2026-10-06T04:00:00Z")).toBe("2026년 10월 6일(화)");
    expect(fmtKstTime("2026-10-06T04:00:00Z")).toBe("13:00");
    expect(fmtKstDateTime("2026-10-06T04:00:00Z")).toBe("2026-10-06 13:00");
    expect(fmtKstDate(null)).toBe("");
  });
  it("시작~종료를 한 줄로 쓴다", () => {
    expect(fmtWhen({ starts_at: "2026-10-06T04:00:00Z", ends_at: "2026-10-06T07:00:00Z" }))
      .toBe("2026년 10월 6일(화) 13:00~16:00 (KST)");
  });
  it("시간 미정이면 날짜만 쓰고 시간을 꾸미지 않는다", () => {
    const s = fmtWhen({ starts_at: "2026-10-21T15:00:00Z", time_tbd: true });
    expect(s).toMatch(/시간 미정$/);
    expect(s).not.toMatch(/\d{2}:\d{2}/);
  });
  it("반복 일정은 안내문과 다음 회차를 함께 쓴다", () => {
    const s = fmtWhen({ starts_at: "2026-10-05T01:30:00Z", recurring_note: "매주 월요일 10:30 (KST)" });
    expect(s).toContain("매주 월요일 10:30 (KST)");
    expect(s).toContain("2026년 10월 5일(월) 10:30");
  });
  it("날짜가 아예 없으면 일정 미정이라고만 쓴다", () => {
    expect(fmtWhen({})).toBe("일정 미정");
    expect(fmtWhen({ recurring_note: "매주 월" })).toBe("매주 월");
  });
  it("여러 날에 걸치면 종료 날짜까지 쓴다", () => {
    expect(fmtWhen({ starts_at: "2026-10-06T04:00:00Z", ends_at: "2026-10-07T04:00:00Z" }))
      .toContain("2026년 10월 7일(수) 13:00");
  });
  it("장소는 확정 전 사정을 그대로 보여준다", () => {
    expect(fmtWhere({ mode: "offline", venue: "숭실대 테크스테이션", address: "상도로55길 6" }))
      .toBe("오프라인 · 숭실대 테크스테이션 · 상도로55길 6");
    expect(fmtWhere({ mode: "offline", venue_note: "제안 단계 · 대관 미확정" }))
      .toBe("오프라인 · 제안 단계 · 대관 미확정");
    expect(fmtWhere({ mode: "online" })).toBe("온라인 · 온라인");
    expect(fmtWhere({ mode: "offline" })).toBe("오프라인 · 장소 미정");
  });
});

describe("datetime-local ↔ 저장값", () => {
  it("화면 값은 KST 로 읽는다", () => {
    expect(kstLocalToIso("2026-10-06T13:00")).toBe("2026-10-06T04:00:00.000Z");
    expect(kstLocalToIso("2026-10-06 13:00")).toBe("2026-10-06T04:00:00.000Z");
    expect(kstLocalToIso("엉뚱한값")).toBeNull();
    expect(kstLocalToIso("")).toBeNull();
  });
  it("왕복해도 같은 값이 된다", () => {
    expect(isoToKstLocal(kstLocalToIso("2026-10-20T13:00"))).toBe("2026-10-20T13:00");
    expect(isoToKstLocal(null)).toBe("");
  });
});

describe("신청 차단 조건(서버 검증)", () => {
  const base = { status: "open", publish: true, apply_open: true, capacity: null, taken: 0 };
  it("열려 있으면 막지 않는다", () => {
    expect(applyBlockers(base)).toEqual([]);
  });
  it("초안·비공개는 막는다", () => {
    expect(applyBlockers({ ...base, publish: false })[0]).toMatch(/공개되지 않은/);
    expect(applyBlockers({ ...base, status: "draft" })[0]).toMatch(/공개되지 않은/);
  });
  it("마감·종료·취소는 각각 다른 이유로 막는다", () => {
    expect(applyBlockers({ ...base, status: "closed" })[0]).toMatch(/마감/);
    expect(applyBlockers({ ...base, status: "done" })[0]).toMatch(/종료/);
    expect(applyBlockers({ ...base, status: "cancelled" })[0]).toMatch(/취소/);
  });
  it("접수를 닫아두면 막는다", () => {
    expect(applyBlockers({ ...base, apply_open: false })[0]).toMatch(/신청을 받지 않습니다/);
  });
  it("정원이 차면 막고, 정원 미설정이면 세지 않는다", () => {
    expect(applyBlockers({ ...base, capacity: 2, taken: 2 })[0]).toMatch(/정원/);
    expect(applyBlockers({ ...base, capacity: 2, taken: 1 })).toEqual([]);
    expect(applyBlockers({ ...base, capacity: null, taken: 9999 })).toEqual([]);
  });
  it("남은 자리는 정원이 있을 때만 숫자로 나온다", () => {
    expect(seatsLeft(null, 5)).toBeNull();
    expect(seatsLeft(10, 3)).toBe(7);
    expect(seatsLeft(10, 12)).toBe(0);
  });
});

describe("외부 노출 항목", () => {
  it("기본은 회사·브랜드·상태뿐이다", () => {
    expect([...DEFAULT_SHARE_FIELDS]).toEqual(["company", "brand", "status"]);
  });
  it("원문 연락처·내부 메모는 고를 수 있는 목록에 없다", () => {
    for (const never of SHARE_NEVER_FIELDS) expect(SHARE_FIELD_KEYS).not.toContain(never);
    expect(SHARE_FIELD_KEYS).not.toContain("phone");
    expect(SHARE_FIELD_KEYS).not.toContain("email");
    expect(SHARE_FIELD_KEYS).not.toContain("admin_note");
  });
  it("연락처·이메일은 마스킹 항목만 있다", () => {
    const phone = SHARE_FIELDS.find((f) => f.key === "phone_masked");
    const email = SHARE_FIELDS.find((f) => f.key === "email_masked");
    expect(phone?.masked).toBe(true);
    expect(email?.masked).toBe(true);
  });
  it("모르는 값은 버리고, 비면 기본값으로 돌린다", () => {
    expect(sanitizeShareFields(["company", "admin_note", "phone"])).toEqual(["company"]);
    expect(sanitizeShareFields([])).toEqual([...DEFAULT_SHARE_FIELDS]);
    expect(sanitizeShareFields("회사")).toEqual([...DEFAULT_SHARE_FIELDS]);
    expect(sanitizeShareFields(null)).toEqual([...DEFAULT_SHARE_FIELDS]);
  });
  it("고른 순서가 아니라 정해진 순서로 돌려준다", () => {
    expect(sanitizeShareFields(["status", "company"])).toEqual(["company", "status"]);
  });
});

describe("마스킹", () => {
  it("전화는 가운데를 지운다", () => {
    const m = maskPhone("010-1234-5678");
    expect(m).toBe("010-****-5678");
    expect(m).not.toContain("1234");
  });
  it("짧은 번호도 원문이 남지 않는다", () => {
    expect(maskPhone("1234")).toBe("****");
    expect(maskPhone("")).toBe("");
  });
  it("이메일은 아이디를 지우고 도메인만 남긴다", () => {
    const m = maskEmail("jaybe@dinostudio.kr");
    expect(m.startsWith("j")).toBe(true);
    expect(m.endsWith("@dinostudio.kr")).toBe(true);
    expect(m).not.toContain("jaybe");
  });
  it("아이디 한 글자도 복원되지 않게 별을 최소 3개 넣는다", () => {
    expect(maskEmail("a@b.kr")).toBe("a***@b.kr");
    expect(maskEmail("")).toBe("");
    expect(maskEmail("골뱅이없음")).toBe("***");
  });
});

describe("외부 공유 활성화 조건", () => {
  it("비밀번호는 길이·형태를 본다", () => {
    expect(sharePwError("1234")).toMatch(new RegExp(`${SHARE_PW_MIN}자`));
    expect(sharePwError("12345678")).toMatch(/숫자만/);
    expect(sharePwError(" abcdefgh")).toMatch(/공백/);
    expect(sharePwError("seminar-2026")).toBeNull();
  });
  it("비밀번호 없이는 켤 수 없다", () => {
    expect(shareEnableBlockers({ password_hash: null, fields: ["company"] })[0]).toMatch(/비밀번호/);
    expect(shareEnableBlockers({ password_hash: "scrypt$..", fields: ["company"] })).toEqual([]);
  });
  it("철회된 링크·빈 노출항목은 켤 수 없다", () => {
    expect(shareEnableBlockers({ password_hash: "x", fields: ["company"], revoked_at: "2026-01-01" })
      .join(" ")).toMatch(/철회/);
    expect(shareEnableBlockers({ password_hash: "x", fields: [] }).join(" ")).toMatch(/항목/);
  });
  it("꺼짐·만료·철회는 열람 불가로 본다", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    expect(shareLive({ enabled: true, password_hash: "x" }, now)).toBe(true);
    expect(shareLive({ enabled: false, password_hash: "x" }, now)).toBe(false);
    expect(shareLive({ enabled: true, password_hash: null }, now)).toBe(false);
    expect(shareLive({ enabled: true, password_hash: "x", revoked_at: "2026-01-01" }, now)).toBe(false);
    expect(shareLive({ enabled: true, password_hash: "x", expires_at: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(shareLive({ enabled: true, password_hash: "x", expires_at: "2026-10-03T00:00:00Z" }, now)).toBe(true);
  });
});

describe("CSV", () => {
  it("따옴표·쉼표·개행을 감싼다", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe("");
  });
  it("엑셀 한글이 깨지지 않게 BOM 을 붙인다", () => {
    const doc = csvDoc(["회사"], [["디노"]]);
    expect(doc.charCodeAt(0)).toBe(0xfeff);
    expect(doc).toContain("디노");
  });
});

describe("안내 문구", () => {
  it("접수와 확정을 구분하는 문장이 있다", () => {
    expect(APPLY_NOT_CONFIRMED_NOTICE).toMatch(/확정/);
  });
  it("보관기간을 새로 만들지 않고 기존 안내 형태를 쓴다", () => {
    expect(PRIVACY_NOTICE).toContain("관련 법령에 따라 처리됩니다");
    expect(PRIVACY_NOTICE).not.toMatch(/\d+\s*(년|개월|일)/);
  });
  it("동의 버전 값이 있다", () => {
    expect(CONSENT_VERSION).toMatch(/^sev-/);
  });
});
