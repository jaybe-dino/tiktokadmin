// 광고 수신거부 — 주소 정규화·본문 부착 규칙(DB 없는 순수 부분).
import { describe, it, expect } from "vitest";
import {
  normalizeAddr, maskAddr, optoutUrlFor, optoutBase, findOptoutLinks,
  withSmsOptout, withMailOptout, SMS_OPTOUT_PREFIX,
} from "../lib/ad-optout";

const TOKEN_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TOKEN_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("주소 정규화·마스킹", () => {
  it("같은 사람을 같은 값으로 — 이메일 대소문자·공백", () => {
    expect(normalizeAddr("email", "  AB@Example.COM ")).toBe("ab@example.com");
  });
  it("전화는 표기가 달라도 같은 값 — 하이픈·국제표기", () => {
    const a = normalizeAddr("phone", "010-1234-5678");
    expect(normalizeAddr("phone", "01012345678")).toBe(a);
    expect(normalizeAddr("phone", "+82 10 1234 5678")).toBe(a);
    expect(normalizeAddr("phone", "008210-1234-5678")).toBe(a);
  });
  it("마스킹은 원문을 드러내지 않는다", () => {
    expect(maskAddr("email", "hongildong@glovek.space")).toBe("ho********@glovek.space");
    expect(maskAddr("phone", "010-1234-5678")).toBe("010****78");
  });
});

describe("수신거부 링크", () => {
  it("고정 HTTPS origin + 짧은 경로", () => {
    const u = optoutUrlFor(TOKEN_A);
    expect(u.startsWith("https://")).toBe(true);
    expect(u.startsWith(optoutBase())).toBe(true);
    expect(u.length).toBeLessThan(100);
  });
  it("토큰이 없으면 링크도 없다", () => {
    expect(optoutUrlFor("")).toBe("");
  });
});

describe("본문에 수신거부 붙이기", () => {
  const sms = `[디노스튜디오·GloveK]
가이드북을 보내드립니다.
▶ 가이드북
https://glovek.space/guidebook
▶ 상담 예약
https://scheduler.zoom.us/nwa36f2letmqfr4bht4pgtzve0/tpartners2`;
  const url = optoutUrlFor(TOKEN_A);

  it("문자 — 기존 본문·링크를 그대로 두고 끝에만 붙인다", () => {
    const out = withSmsOptout(sms, url);
    expect(out.startsWith(sms.trim())).toBe(true);
    expect(out).toContain("https://glovek.space/guidebook");
    expect(out).toContain("scheduler.zoom.us");
    expect(out).toContain(SMS_OPTOUT_PREFIX + url);
  });
  it("메일 — 본문 보존 + 광고/서비스 구분 안내", () => {
    const body = "안녕하세요.\n\n자료: https://glovek.space/tts/qna";
    const out = withMailOptout(body, url);
    expect(out.startsWith(body)).toBe(true);
    expect(out).toContain("https://glovek.space/tts/qna");
    expect(out).toContain("광고에만 적용");
    expect(out).toContain("서비스 안내는 계속");
  });
  it("같은 링크를 두 번 붙이지 않는다", () => {
    const once = withSmsOptout(sms, url);
    expect(withSmsOptout(once, url)).toBe(once);
  });

  // ── 회귀: 다른 사이트의 /u/ 경로를 우리 수신거부 링크로 오인하면 안 된다 ──
  it("다른 사이트의 /u/ URL 이 있어도 우리 링크는 정상적으로 붙는다", () => {
    const body = `자료 보기 https://example.com/u/abc123 입니다.`;
    const out = withSmsOptout(body, url);
    expect(out).toContain("https://example.com/u/abc123");   // 남의 링크는 그대로
    expect(out).toContain(url);                              // 우리 링크는 붙는다
    expect(findOptoutLinks(out)).toEqual([url]);
  });
  it("'무료수신거부' 라는 말만 있고 링크가 없으면 링크를 붙인다", () => {
    const body = "본문입니다. 무료수신거부 안내는 아래를 참고하세요.";
    expect(withSmsOptout(body, url)).toContain(url);
  });
  it("예전 수신자의 링크가 남아 있으면 현재 수신자 링크로 바꾼다", () => {
    const stale = withSmsOptout(sms, optoutUrlFor(TOKEN_B));
    const fixed = withSmsOptout(stale, url);
    expect(fixed).toContain(url);
    expect(fixed).not.toContain(optoutUrlFor(TOKEN_B));
    expect(findOptoutLinks(fixed)).toEqual([url]);           // 하나만 남는다
  });
  it("메일도 예전 링크를 현재 링크로 바꾼다", () => {
    const stale = withMailOptout("본문", optoutUrlFor(TOKEN_B));
    const fixed = withMailOptout(stale, url);
    expect(fixed).toContain(url);
    expect(fixed).not.toContain(optoutUrlFor(TOKEN_B));
  });
  it("링크를 못 만들면(연락처 없음) 본문 그대로", () => {
    expect(withSmsOptout(sms, "")).toBe(sms);
  });
  it("수신자마다 링크가 다르다 — 남의 링크로 남을 거부시킬 수 없다", () => {
    expect(optoutUrlFor(TOKEN_A)).not.toBe(optoutUrlFor(TOKEN_B));
  });
});
