// 전사 다운로드 — 토큰 위치(최상위) · 주소↔토큰 짝 · 헤더 인증 · 리다이렉트 · 오류 표시.
//   실제 Zoom 호출은 없다(fetch 를 가짜로 둔다). 비밀값은 어떤 반환값에도 담기지 않아야 한다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.ZOOM_ACCOUNT_ID ||= "acct";
process.env.ZOOM_CLIENT_ID ||= "cid";
process.env.ZOOM_CLIENT_SECRET ||= "csecret";

import {
  downloadZoomFile, downloadZoomFileWithS2S, getMeetingRecordings, resetZoomToken,
  encodeMeetingUuid, SCOPE_LIST_RECORDING_FILES,
} from "../lib/zoom-api";
import { eventDownloadToken, dedupeKey, type ZoomEventPayload } from "../lib/zoom-ingest";

const WEBHOOK_URL = "https://us06web.zoom.us/rec/webhook_download/abc";
const WEBHOOK_TOKEN = "webhook-download-token-value";
const S2S_TOKEN = "s2s-access-token-value";
const VTT = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n대표: 안녕하세요.\n";

interface Call { url: string; auth: string | null }
let calls: Call[] = [];
let handler: (url: string, auth: string | null) => Response;

function res(status: number, body = "", headers: Record<string, string> = {}): Response {
  return new Response(status === 204 || status >= 300 ? null : body, { status, headers });
}

beforeEach(() => {
  calls = [];
  resetZoomToken();
  handler = () => res(200, VTT);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    // 토큰 발급 요청은 항상 성공시킨다.
    if (url.startsWith("https://zoom.us/oauth/token")) {
      return new Response(JSON.stringify({ access_token: S2S_TOKEN, expires_in: 3600 }), { status: 200 });
    }
    calls.push({ url, auth });
    return handler(url, auth);
  });
});
afterEach(() => { vi.unstubAllGlobals(); resetZoomToken(); });

describe("이벤트 최상위 download_token", () => {
  const base = (extra: Partial<ZoomEventPayload>): ZoomEventPayload => ({
    event: "recording.transcript_completed",
    payload: { object: { uuid: "bOlZy1mWSB2hozHmSimdQA==", recording_files: [{ id: "f1", file_type: "TRANSCRIPT" }] } },
    ...extra,
  });

  it("최상위에 온 토큰을 읽는다 — payload 안만 보면 누락된다", () => {
    expect(eventDownloadToken(base({ download_token: "TOP" }))).toBe("TOP");
  });
  it("예전 표기(payload 안)도 대비한다", () => {
    const evt = base({});
    evt.payload!.download_token = "INNER";
    expect(eventDownloadToken(evt)).toBe("INNER");
  });
  it("최상위가 우선이다", () => {
    const evt = base({ download_token: "TOP" });
    evt.payload!.download_token = "INNER";
    expect(eventDownloadToken(evt)).toBe("TOP");
  });
  it("토큰이 없으면 null — 빈 문자열도 없음으로 본다", () => {
    expect(eventDownloadToken(base({}))).toBeNull();
    expect(eventDownloadToken(base({ download_token: "   " }))).toBeNull();
  });
  it("토큰은 이벤트 고유키에 섞이지 않는다(재전송 판정이 흔들리지 않게)", () => {
    expect(dedupeKey(base({ download_token: "A" }))).toBe(dedupeKey(base({ download_token: "B" })));
  });
});

describe("다운로드 — 헤더 인증만 쓴다", () => {
  it("토큰을 Authorization 헤더로 보낸다(URL 쿼리에 넣지 않는다)", async () => {
    const r = await downloadZoomFile(WEBHOOK_URL, { kind: "webhook", token: WEBHOOK_TOKEN });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("안녕하세요");
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe(`Bearer ${WEBHOOK_TOKEN}`);
    expect(calls[0].url).not.toContain(WEBHOOK_TOKEN);
    expect(calls[0].url).not.toContain("access_token");
  });

  it("401 이면 사유를 구분해 알리고 비밀값은 담지 않는다", async () => {
    handler = () => res(401, "");
    const r = await downloadZoomFile(WEBHOOK_URL, { kind: "webhook", token: WEBHOOK_TOKEN });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("401");
    expect(r.error).toContain("웹훅 토큰 만료");
    expect(r.error).not.toContain(WEBHOOK_TOKEN);
  });

  it("S2S 토큰으로 401 이면 스코프 승인 쪽을 가리킨다", async () => {
    handler = () => res(401, "");
    const r = await downloadZoomFileWithS2S(WEBHOOK_URL);
    expect(r.error).toContain("스코프");
    expect(r.error).not.toContain(S2S_TOKEN);
  });

  it("zoom 도메인이 아니면 아예 요청하지 않는다", async () => {
    const r = await downloadZoomFile("https://evil.example.com/rec/x", { kind: "webhook", token: WEBHOOK_TOKEN });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("허용되지 않은");
    expect(calls).toHaveLength(0);
  });

  it("http 주소도 거절한다", async () => {
    const r = await downloadZoomFile("http://us06web.zoom.us/rec/x", { kind: "webhook", token: WEBHOOK_TOKEN });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("토큰이 비어 있으면 요청하지 않는다", async () => {
    const r = await downloadZoomFile(WEBHOOK_URL, { kind: "webhook", token: "" });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("리다이렉트 — 다른 호스트로 인증 헤더를 넘기지 않는다", () => {
  it("302 를 따라가되 두 번째 요청에는 Authorization 을 붙이지 않는다", async () => {
    handler = (url) => url === WEBHOOK_URL
      ? res(302, "", { location: "https://ssrweb.zoom.us/signed/abc?sig=1" })
      : res(200, VTT);
    const r = await downloadZoomFile(WEBHOOK_URL, { kind: "webhook", token: WEBHOOK_TOKEN });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].auth).toBe(`Bearer ${WEBHOOK_TOKEN}`);
    expect(calls[1].auth).toBeNull();                     // 서명된 주소에 인증 헤더를 얹으면 401 이 난다
  });

  it("CDN 으로 가는 리다이렉트도 허용한다", async () => {
    handler = (url) => url.includes("cloudfront")
      ? res(200, VTT)
      : res(302, "", { location: "https://d123.cloudfront.net/x" });
    const r = await downloadZoomFile(WEBHOOK_URL, { kind: "webhook", token: WEBHOOK_TOKEN });
    expect(r.ok).toBe(true);
  });

  it("엉뚱한 호스트로 유도하면 멈춘다", async () => {
    handler = () => res(302, "", { location: "https://evil.example.com/steal" });
    const r = await downloadZoomFile(WEBHOOK_URL, { kind: "webhook", token: WEBHOOK_TOKEN });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("리다이렉트");
    expect(calls).toHaveLength(1);
  });

  it("리다이렉트가 끝없이 이어지면 멈춘다", async () => {
    handler = () => res(302, "", { location: "https://us06web.zoom.us/rec/loop" });
    const r = await downloadZoomFile(WEBHOOK_URL, { kind: "webhook", token: WEBHOOK_TOKEN });
    expect(r.ok).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(7);
  });
});

describe("녹화 목록 API 오류 — 권한 문제를 구분해 알린다", () => {
  it("세분화 스코프 누락(400 code 4700)이면 필요한 스코프 이름을 적는다", async () => {
    handler = () => new Response(JSON.stringify({
      code: 4700,
      message: "Invalid access token, does not contain scopes:[cloud_recording:read:list_recording_files:admin]",
    }), { status: 400 });
    const r = await getMeetingRecordings("bOlZy1mWSB2hozHmSimdQA==");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("400");
    expect(r.error).toContain("code 4700");
    expect(r.error).toContain("권한(스코프) 승인 필요");
    expect(r.error).toContain(SCOPE_LIST_RECORDING_FILES);
    expect(r.error).not.toContain(S2S_TOKEN);
  });

  it("404 는 권한이 아니라 '녹화 없음'으로 구분한다", async () => {
    handler = () => res(404, "");
    const r = await getMeetingRecordings("x==");
    expect(r.error).toContain("녹화 없음");
    expect(r.error).not.toContain("스코프");
  });

  it("오류 본문에 토큰 형태 문자열이 섞여 와도 지운다", async () => {
    handler = () => new Response(JSON.stringify({
      code: 124, message: "Invalid access token eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbb",
    }), { status: 401 });
    const r = await getMeetingRecordings("x==");
    expect(r.error).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(r.error).toContain("[생략]");
  });

  it("== 로 끝나는 UUID 를 한 번만 인코딩한다(400 유발 방지)", () => {
    expect(encodeMeetingUuid("bOlZy1mWSB2hozHmSimdQA==")).toBe("bOlZy1mWSB2hozHmSimdQA%3D%3D");
    // 슬래시가 든 UUID 는 두 번 인코딩해야 경로가 깨지지 않는다.
    expect(encodeMeetingUuid("/abc//def==")).toBe(encodeURIComponent(encodeURIComponent("/abc//def==")));
  });
});
