// 세미나 제공자 경계 — 실제 헬퍼(mailer·sms)를 그대로 쓰고 "네트워크만" 모의한다.
//   확인하는 것
//     · 기록한 본문 == 제공자에게 실제로 넘어간 본문(공용 푸터 포함)
//     · 연결 실패·시간초과 → ok:false + indeterminate (명시적 거절과 구분)
//     · 결과 불명일 때 다른 제공자로 다시 보내지 않는다
//   실제 발송은 없다 — fetch 자체를 바꿔치기한다.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { finalEmailText, finalBody, sendSeminarEmail, sendSeminarSms } from "../lib/seminar-transport";
import { appendFooter } from "../lib/email-footer";

// Gmail 은 별도 외부 API 경계다 — 그 경계만 바꿔 끼운다(기본은 꺼짐).
const gmail = vi.hoisted(() => ({ enabled: false, result: { ok: false, error: "Gmail 거절(검수용)" } as { ok: boolean; id?: string; error?: string } }));
vi.mock("../lib/gmail-client", () => ({
  gmailComposeEnabled: () => gmail.enabled,
  sendGmailMessage: async () => gmail.result,
}));
vi.mock("../lib/shared-mailboxes", () => ({ defaultSendMailbox: async () => "sender@example.invalid" }));

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

interface Call { url: string; body: unknown }
const calls: Call[] = [];
const realFetch = globalThis.fetch;
const ENV = { ...process.env };

/** 네트워크 경계만 바꾼다. 요청 내용을 그대로 모아 둔다. */
function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    let body: unknown = init.body;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { /* 폼이면 그대로 */ } }
    if (init.body instanceof URLSearchParams) body = Object.fromEntries(init.body);
    calls.push({ url, body });
    return handler(url, init);
  }) as typeof globalThis.fetch;
}
const jsonRes = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  gmail.enabled = false;
  gmail.result = { ok: false, error: "Gmail 거절(검수용)" };
  // Gmail 위임은 꺼진 상태(= Resend 경로). ALIGO 는 프록시 없이 직접 호출.
  delete process.env.GOOGLE_SA_KEY_JSON;
  delete process.env.ALIGO_PROXY_URL;
  delete process.env.FIXIE_URL;
  process.env.RESEND_API_KEY = "test-key-not-real";
  process.env.RESEND_FROM = "Glovek <test@example.invalid>";
  process.env.ALIGO_API_KEY = "test-key-not-real";
  process.env.ALIGO_USER_ID = "test-user";
  process.env.ALIGO_SENDER = "0200000000";
  process.env.ALIGO_TEST_MODE = "Y";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...ENV };
});

describe("기록한 본문 == 실제로 나간 본문", () => {
  it("메일은 공용 푸터까지 붙인 값을 기록하고 그대로 보낸다", async () => {
    stubFetch(() => jsonRes(200, { id: "re_1" }));
    const composed = "담당자님 안녕하세요.\n세미나 안내입니다.";
    // 기록에 남길 "최종 본문"
    const recorded = await finalEmailText(composed);
    expect(recorded).not.toBe(composed);
    expect(recorded).toBe(appendFooter(composed));        // 푸터가 포함돼 있다

    const r = await sendSeminarEmail("to@example.invalid", "제목", recorded);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const sent = (calls[0].body as { text: string; subject: string }).text;
    expect(sent).toBe(recorded);                          // 글자까지 같다
  });

  it("푸터를 두 번 붙이지 않는다(기록을 그대로 넘겨도 안전)", async () => {
    stubFetch(() => jsonRes(200, { id: "re_2" }));
    const recorded = await finalEmailText("본문");
    await sendSeminarEmail("to@example.invalid", "제목", recorded);
    const sent = (calls[0].body as { text: string }).text;
    expect(sent).toBe(recorded);
    expect(sent.split("No.1 tiktokshop partners Glovek")).toHaveLength(2);   // 한 번만
  });

  it("문자는 본문을 건드리지 않는다", async () => {
    stubFetch(() => jsonRes(200, { result_code: 1, msg_id: "aligo-1", message: "성공" }));
    const body = "[GloveK] 세미나 안내\nhttps://zoom.example/j/1";
    expect(await finalBody("sms", body)).toBe(body);
    const r = await sendSeminarSms("01000000000", body, "GloveK 세미나");
    expect(r.ok).toBe(true);
    expect((calls[0].body as { msg: string }).msg).toBe(body);
  });
});

describe("명시적 거절 vs 결과 불명", () => {
  it("메일: 제공자가 거절하면 결과가 확정이다", async () => {
    stubFetch(() => jsonRes(422, { message: "invalid recipient" }));
    const r = await sendSeminarEmail("to@example.invalid", "제목", "본문");
    expect(r.ok).toBe(false);
    expect(r.indeterminate).toBeFalsy();                  // 재시도해도 되는 실패
    expect(r.error).toContain("invalid recipient");
  });

  it("메일: 연결이 끊기면 결과 불명으로 분류한다", async () => {
    stubFetch(() => { throw new TypeError("fetch failed"); });
    const r = await sendSeminarEmail("to@example.invalid", "제목", "본문");
    expect(r.ok).toBe(false);
    expect(r.indeterminate).toBe(true);
  });

  it("메일: 시간 초과도 결과 불명이다", async () => {
    stubFetch(() => { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; });
    const r = await sendSeminarEmail("to@example.invalid", "제목", "본문");
    expect(r.ok).toBe(false);
    expect(r.indeterminate).toBe(true);
  });

  it("문자: ALIGO 가 코드를 돌려주면 명시적 거절이다", async () => {
    stubFetch(() => jsonRes(200, { result_code: -101, message: "인증오류" }));
    const r = await sendSeminarSms("01000000000", "본문", "제목");
    expect(r.ok).toBe(false);
    expect(r.indeterminate).toBeFalsy();
    expect(r.error).toContain("인증오류");
  });

  it("문자: 연결 실패는 결과 불명이다", async () => {
    stubFetch(() => { throw new TypeError("fetch failed"); });
    const r = await sendSeminarSms("01000000000", "본문", "제목");
    expect(r.ok).toBe(false);
    expect(r.indeterminate).toBe(true);
  });

  it("문자: 설정이 없으면 호출 자체가 없고 결과가 확정이다", async () => {
    delete process.env.ALIGO_API_KEY;
    stubFetch(() => jsonRes(200, { result_code: 1 }));
    const r = await sendSeminarSms("01000000000", "본문", "제목");
    expect(r.ok).toBe(false);
    expect(r.indeterminate).toBeFalsy();
    expect(calls).toHaveLength(0);
  });

  it("메일: 발송 설정이 없으면 호출 자체가 없고 결과가 확정이다", async () => {
    delete process.env.RESEND_API_KEY;
    stubFetch(() => jsonRes(200, { id: "x" }));
    const r = await sendSeminarEmail("to@example.invalid", "제목", "본문");
    expect(r.ok).toBe(false);
    expect(r.indeterminate).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("결과 불명일 때 다른 제공자로 또 보내지 않는다", () => {
  it("Gmail 이 거절해도 Resend 로 넘어가지 않는다", async () => {
    gmail.enabled = true;
    gmail.result = { ok: false, error: "Gmail 거절(검수용)" };
    stubFetch(() => jsonRes(200, { id: "re_should_not_be_used" }));
    const r = await sendSeminarEmail("to@example.invalid", "제목", "본문");
    expect(r.ok).toBe(false);
    expect(r.provider).toBe("gmail");
    expect(r.indeterminate).toBe(false);                 // 제공자가 응답한 거절이다
    // 폴백했다면 api.resend.com 호출이 있었을 것이다.
    expect(calls.filter((c) => c.url.includes("api.resend.com"))).toHaveLength(0);
  });

  it("Gmail 연결이 끊기면 결과 불명이고, 역시 Resend 로 넘어가지 않는다", async () => {
    gmail.enabled = true;
    vi.mocked(await import("../lib/gmail-client")).sendGmailMessage = (async () => {
      throw new TypeError("fetch failed");
    }) as never;
    stubFetch(() => jsonRes(200, { id: "re_should_not_be_used" }));
    const r = await sendSeminarEmail("to@example.invalid", "제목", "본문");
    expect(r.ok).toBe(false);
    expect(r.indeterminate).toBe(true);
    expect(calls.filter((c) => c.url.includes("api.resend.com"))).toHaveLength(0);
  });

  it("Gmail 이 켜져 있으면 그 경로로 보내고 기록한 본문을 그대로 넘긴다", async () => {
    gmail.enabled = true;
    const seen: string[] = [];
    vi.mocked(await import("../lib/gmail-client")).sendGmailMessage = (async (m: { bodyText: string }) => {
      seen.push(m.bodyText); return { ok: true, id: "gm_1" };
    }) as never;
    const recorded = await finalEmailText("본문입니다");
    const r = await sendSeminarEmail("to@example.invalid", "제목", recorded);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("gmail");
    expect(seen[0]).toBe(recorded);                      // 푸터 재부착 없음
  });
});

describe("배선 감사", () => {
  it("세미나 경로는 푸터 재부착·제공자 폴백을 끈 채로 보낸다", () => {
    const t = code("../lib/seminar-transport.ts");
    expect(t).toMatch(/skipFooter: true/);
    expect(t).toMatch(/noFallback: true/);
  });
  it("공용 헬퍼의 기본 동작은 그대로다(옵션 미지정 시 푸터 부착·폴백)", () => {
    const m = code("../lib/mailer.ts");
    expect(m).toMatch(/input\.skipFooter \? input\.text : appendFooter\(input\.text\)/);
    expect(m).toMatch(/if \(!input\.noFallback\) throw e;/);
    expect(m).toMatch(/if \(input\.noFallback\) return \{ ok: false, via: "gmail"/);
  });
  it("발송 경로는 기록한 payload 를 그대로 넘긴다", () => {
    const lib = code("../lib/seminar.ts");
    expect(lib).toMatch(/payload = \{ subject: msg\.subject, body: await finalBody\(r\.channel, msg\.body\) \}/);
    expect(lib).toMatch(/body: payload\.body/);
    expect(lib).toMatch(/sendSeminarMessage\(r\.channel, to, payload\)/);
    // 공용 헬퍼를 직접 부르지 않는다(경계는 어댑터 하나뿐).
    expect(lib).not.toMatch(/from "\.\/mailer"/);
    expect(lib).not.toMatch(/from "\.\/sms"/);
  });
});
