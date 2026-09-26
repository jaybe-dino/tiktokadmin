// Zoom 웹훅 인증 — 시크릿 미설정 fail closed · 서명 · 재전송 방어.
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyZoomWebhook, urlValidationAnswer, REPLAY_WINDOW_SEC } from "../lib/zoom-webhook-auth";

const SECRET = "test-webhook-secret";
const RAW = JSON.stringify({ event: "recording.completed", payload: { object: { uuid: "abc==" } } });
const sign = (ts: string, raw = RAW, secret = SECRET) =>
  "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");

describe("시크릿 미설정 — fail closed", () => {
  it("시크릿이 없으면 서명이 맞아도 받지 않는다(503)", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const r = verifyZoomWebhook({ secret: undefined, ts, sig: sign(ts), raw: RAW });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });
  it("빈 문자열 시크릿도 미설정으로 본다", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyZoomWebhook({ secret: "", ts, sig: sign(ts), raw: RAW }).status).toBe(503);
  });
  it("URL 검증도 시크릿 없이는 응답하지 않는다 — plainToken 을 그대로 돌려주지 않는다", () => {
    expect(urlValidationAnswer(undefined, "plain-1")).toBeNull();
    const answer = urlValidationAnswer(SECRET, "plain-1");
    expect(answer).not.toBeNull();
    expect(answer).not.toBe("plain-1");
    expect(answer).toBe(createHmac("sha256", SECRET).update("plain-1").digest("hex"));
  });
});

describe("서명·재전송 방어", () => {
  it("올바른 서명은 통과한다", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyZoomWebhook({ secret: SECRET, ts, sig: sign(ts), raw: RAW }).ok).toBe(true);
  });
  it("본문이 한 글자라도 바뀌면 거절한다(401)", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const r = verifyZoomWebhook({ secret: SECRET, ts, sig: sign(ts), raw: RAW + " " });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("다른 시크릿으로 만든 서명은 거절한다", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyZoomWebhook({ secret: SECRET, ts, sig: sign(ts, RAW, "other"), raw: RAW }).status).toBe(401);
  });
  it("허용 시간(5분)을 넘긴 타임스탬프는 거절한다 — 가로챈 요청 재전송 차단", () => {
    const now = Date.now();
    const old = String(Math.floor(now / 1000) - REPLAY_WINDOW_SEC - 10);
    const r = verifyZoomWebhook({ secret: SECRET, ts: old, sig: sign(old), raw: RAW, nowMs: now });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("타임스탬프·서명 헤더가 없으면 거절한다", () => {
    expect(verifyZoomWebhook({ secret: SECRET, ts: null, sig: null, raw: RAW }).status).toBe(401);
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyZoomWebhook({ secret: SECRET, ts, sig: null, raw: RAW }).status).toBe(401);
  });
});
