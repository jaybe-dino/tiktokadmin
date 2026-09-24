// 광고 수신거부 — 토큰·본문 부착·차단 판정의 단위 규칙.
//   (DB 가 필요한 흐름은 tests/ad-optout-flow.test.ts 에서 mock 으로 통합 검증)
import { describe, it, expect } from "vitest";
import {
  normalizeAddr, maskAddr, addrHash, mintToken, verifyToken, optoutUrl,
  hasOptoutNotice, withSmsOptout, withMailOptout, OPTOUT_PATH, SMS_OPTOUT_PREFIX,
} from "../lib/ad-optout";

describe("주소 정규화·마스킹", () => {
  it("같은 사람을 같은 값으로 — 이메일 대소문자·공백", () => {
    expect(normalizeAddr("email", "  AB@Example.COM ")).toBe("ab@example.com");
    expect(addrHash("email", "AB@example.com")).toBe(addrHash("email", "ab@EXAMPLE.com"));
  });
  it("전화는 표기가 달라도 같은 값 — 하이픈·국제표기", () => {
    const a = addrHash("phone", "010-1234-5678");
    expect(addrHash("phone", "01012345678")).toBe(a);
    expect(addrHash("phone", "+82 10 1234 5678")).toBe(a);
    expect(addrHash("phone", "008210-1234-5678")).toBe(a);
  });
  it("다른 사람은 다른 값", () => {
    expect(addrHash("email", "a@x.com")).not.toBe(addrHash("email", "b@x.com"));
    expect(addrHash("phone", "01012345678")).not.toBe(addrHash("phone", "01012345679"));
  });
  it("같은 문자열이라도 수단이 다르면 다른 값", () => {
    expect(addrHash("email", "01012345678")).not.toBe(addrHash("phone", "01012345678"));
  });
  it("해시에 원문이 남지 않는다", () => {
    const h = addrHash("email", "secret.person@company.com");
    expect(h).not.toContain("secret");
    expect(h).not.toContain("company");
    expect(h).toMatch(/^[0-9a-f]{24}$/);
  });
  it("마스킹은 원문을 드러내지 않는다", () => {
    expect(maskAddr("email", "hongildong@glovek.space")).toBe("ho********@glovek.space");
    expect(maskAddr("phone", "010-1234-5678")).toBe("010****78");
  });
  it("빈 값은 빈 값", () => {
    expect(addrHash("email", "")).toBe("");
    expect(mintToken("phone", "")).toBe("");
  });
});

describe("수신거부 토큰", () => {
  const email = "customer@example.com";
  it("토큰으로 대상을 되찾을 수 있다", () => {
    const t = mintToken("email", email);
    expect(verifyToken(t)).toEqual({ kind: "email", hash: addrHash("email", email) });
  });
  it("토큰에 이메일·전화 평문이 들어가지 않는다", () => {
    const t = mintToken("email", email);
    expect(t).not.toContain("customer");
    expect(t).not.toContain("example");
    expect(t).not.toContain("@");
    expect(mintToken("phone", "01012345678")).not.toContain("1012345678");
  });
  it("연속 ID 추측이 불가능하다 — 이웃한 주소의 토큰이 이어지지 않는다", () => {
    const a = mintToken("phone", "01000000001");
    const b = mintToken("phone", "01000000002");
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    expect(same).toBeLessThan(a.length * 0.6);
  });
  it("한 글자만 바꿔도 무효 — 변조 링크는 받아들이지 않는다", () => {
    const t = mintToken("email", email);
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "a" ? "b" : "a") + s.slice(i + 1);
    expect(verifyToken(flip(t, 3))).toBeNull();     // 해시 변조
    expect(verifyToken(flip(t, t.length - 1))).toBeNull();  // 서명 변조
    expect(verifyToken(`p${t.slice(1)}`)).toBeNull();       // 수단 바꿔치기
  });
  it("길이·형식이 어긋나면 무효", () => {
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("abc")).toBeNull();
    expect(verifyToken(mintToken("email", email) + "x")).toBeNull();
    expect(verifyToken("x" + mintToken("email", email).slice(1))).toBeNull();
  });
  it("URL 은 고정 origin + 짧은 경로", () => {
    const u = optoutUrl("phone", "01012345678");
    expect(u).toMatch(/^https:\/\//);
    expect(u).toContain(OPTOUT_PATH);
    expect(u.length).toBeLessThan(90);   // 문자에 넣어도 부담 없는 길이
  });
});

describe("본문에 수신거부 붙이기", () => {
  const sms = `[디노스튜디오·GloveK]
가이드북을 보내드립니다.
▶ 가이드북
https://glovek.space/guidebook
▶ 상담 예약
https://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2`;
  const url = optoutUrl("phone", "01012345678");

  it("문자 — 기존 본문·링크를 그대로 두고 끝에만 붙인다", () => {
    const out = withSmsOptout(sms, url);
    expect(out.startsWith(sms.trim())).toBe(true);
    expect(out).toContain("https://glovek.space/guidebook");
    expect(out).toContain("scheduler.zoom.us");
    expect(out).toContain(SMS_OPTOUT_PREFIX);
    expect(out).toContain(url);
  });
  it("메일 — 본문 보존 + 광고/서비스 구분 안내", () => {
    const body = "안녕하세요.\n\n자료: https://glovek.space/tts/qna";
    const out = withMailOptout(body, optoutUrl("email", "a@b.com"));
    expect(out.startsWith(body)).toBe(true);
    expect(out).toContain("https://glovek.space/tts/qna");
    expect(out).toContain("광고에만 적용");
    expect(out).toContain("서비스 안내는 계속");
  });
  it("두 번 붙이지 않는다", () => {
    const once = withSmsOptout(sms, url);
    expect(withSmsOptout(once, url)).toBe(once);
    const m = withMailOptout("본문", optoutUrl("email", "a@b.com"));
    expect(withMailOptout(m, optoutUrl("email", "a@b.com"))).toBe(m);
  });
  it("이미 수신거부 문구가 있으면 건드리지 않는다", () => {
    const manual = `본문\n무료수신거부 08012345678`;
    expect(hasOptoutNotice(manual)).toBe(true);
    expect(withSmsOptout(manual, url)).toBe(manual);
  });
  it("링크를 못 만들면(연락처 없음) 본문 그대로", () => {
    expect(withSmsOptout(sms, "")).toBe(sms);
  });
  it("수신자마다 링크가 다르다 — 남의 링크로 남을 거부시킬 수 없다", () => {
    expect(optoutUrl("phone", "01011112222")).not.toBe(optoutUrl("phone", "01033334444"));
  });
});
