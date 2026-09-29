// 문자 발송 "fetch failed" 진단 — 진짜 원인(error.cause)을 버리지 않는다.
import { describe, it, expect } from "vitest";
import { netReason } from "../lib/sms";
import { readFileSync } from "node:fs";

/** Node fetch 가 던지는 모양 — 메시지는 항상 "fetch failed", 사유는 cause 에 있다. */
const fetchFailed = (code: string, message: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(message), { code }) });

describe("네트워크 실패 사유", () => {
  it("DNS 실패를 알아본다", () => {
    const r = netReason(fetchFailed("ENOTFOUND", "getaddrinfo ENOTFOUND apis.aligo.in"));
    expect(r).toContain("ENOTFOUND");
    expect(r).toContain("주소를 찾지 못함");
    expect(r).toContain("apis.aligo.in");
  });
  it("연결 거부·시간 초과·끊김을 구분한다", () => {
    expect(netReason(fetchFailed("ECONNREFUSED", "connect ECONNREFUSED"))).toContain("연결 거부");
    expect(netReason(fetchFailed("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error"))).toContain("연결 시간 초과");
    expect(netReason(fetchFailed("ECONNRESET", "socket hang up"))).toContain("연결이 끊김");
  });
  it("프록시 인증 실패(407)를 알아본다", () => {
    expect(netReason(fetchFailed("", "Proxy response (407) !== 200"))).toContain("프록시 인증 실패");
  });
  it("TLS 인증서 문제를 알아본다", () => {
    expect(netReason(fetchFailed("CERT_HAS_EXPIRED", "certificate has expired"))).toContain("인증서");
  });
  it("cause 가 없어도 메시지를 남긴다 — 빈 문자열로 끝내지 않는다", () => {
    expect(netReason(new Error("boom"))).toContain("boom");
    expect(netReason(fetchFailed("", ""))).toBeTruthy();
  });
  it("'fetch failed' 한 줄로 끝나지 않는다", () => {
    const r = netReason(fetchFailed("ENOTFOUND", "getaddrinfo ENOTFOUND proxy.example"));
    expect(r).not.toBe("fetch failed");
    expect(r.length).toBeGreaterThan("fetch failed".length);
  });
});

describe("프록시 경유 실패를 조용히 직접 발송으로 넘기지 않는다", () => {
  const src = readFileSync(new URL("../lib/sms.ts", import.meta.url), "utf8");

  it("프록시 fetch 를 await 해서 실패를 잡는다(예전엔 return 만 해 catch 를 지나쳤다)", () => {
    expect(src).toContain("return await fetch(url, { ...init, dispatcher }");
  });
  it("프록시 실패는 프록시 호스트와 함께 알린다", () => {
    expect(src).toContain("ALIGO 고정IP 프록시 연결 실패");
  });
  it("발송 실패 메시지에 원인을 붙인다", () => {
    expect(src).toContain("netReason(e)");
    expect(src).not.toMatch(/return \{ ok: false, message: \(e as Error\)\.message \};/);
  });
  it("점검은 문자를 보내지 않고 잔여 건수로만 확인한다", () => {
    expect(src).toContain("export async function checkSms");
    expect(src).toContain("await smsRemain()");
    expect(src).not.toMatch(/checkSms[\s\S]{0,600}sendSms\(/);
  });
  it("점검 결과에 키·프록시 비밀번호가 담기지 않는다", () => {
    expect(src).toContain("proxyHost");
    expect(src).not.toMatch(/proxyUrl:\s*proxy/);
    expect(src).not.toMatch(/apiKey:\s*env\.aligo\.apiKey/);
  });
});
