// BUG-60 — AI 판정 경로. 모델을 가짜로 두고 "이상한 응답이 와도 안전한가" 를 본다.
import { describe, it, expect, vi, beforeEach } from "vitest";

let reply: unknown = null;
let threw: Error | null = null;
let calls = 0;

vi.mock("../lib/ai", () => ({
  AI_MODEL: "test-model",
  aiEnabled: () => true,
  aiClient: () => ({
    messages: {
      create: async () => {
        calls++;
        if (threw) throw threw;
        return { content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }] };
      },
    },
  }),
}));
vi.mock("../lib/db", () => ({ query: async () => [], queryOne: async () => null }));

const { checkDocument } = await import("../lib/onb-doc-check");

// 충분히 크고 해상도도 되는 가짜 PNG — 기계 검사를 통과시킨다.
function bigPng(w = 1600, h = 1200): Buffer {
  const b = Buffer.alloc(80 * 1024);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const doc = (bytes = bigPng()) => ({ field: "doc_biz_reg_en", mime: "image/png", size: bytes.length, bytes });

beforeEach(() => { reply = null; threw = null; calls = 0; });

describe("BUG-60 — AI 판정", () => {
  it("반려 판정과 사유가 그대로 온다", async () => {
    reply = { verdict: "reject", reasons: ["unreadable", "cropped"] };
    const r = await checkDocument(doc());
    expect(r).toEqual({ verdict: "reject", reasons: ["unreadable", "cropped"], aiUsed: true });
  });

  it("설명을 덧붙여 와도 JSON 만 읽는다", async () => {
    reply = '판정 결과입니다.\n{"verdict":"warn","reasons":["masked"]}\n감사합니다.';
    const r = await checkDocument(doc());
    expect(r.verdict).toBe("warn");
    expect(r.reasons).toEqual(["masked"]);
  });

  it("지어낸 사유 코드는 버린다", async () => {
    reply = { verdict: "reject", reasons: ["서류가 흐릿합니다", "unreadable"] };
    const r = await checkDocument(doc());
    expect(r.reasons).toEqual(["unreadable"]);
  });

  it("사유 없는 반려는 '확인 필요' 로 낮춘다 — 고칠 방법을 못 주면 반려로 쓸 수 없다", async () => {
    reply = { verdict: "reject", reasons: [] };
    const r = await checkDocument(doc());
    expect(r.verdict).toBe("warn");
    expect(r.reasons).toEqual(["not_checked"]);
  });

  it("호출이 실패해도 통과로 바꾸지 않는다", async () => {
    threw = new Error("429 rate limit");
    const r = await checkDocument(doc());
    expect(r.verdict).toBe("warn");
    expect(r.reasons).toEqual(["not_checked"]);
  });

  it("JSON 이 아니면 통과로 바꾸지 않는다", async () => {
    reply = "판단 불가";
    const r = await checkDocument(doc());
    expect(r.verdict).toBe("warn");
  });

  it("기계 검사에서 이미 반려면 AI 를 부르지 않는다(비용)", async () => {
    reply = { verdict: "pass", reasons: [] };
    const r = await checkDocument({ field: "doc_biz_reg_en", mime: "image/png", size: 50, bytes: Buffer.alloc(50) });
    expect(r.verdict).toBe("reject");
    expect(r.aiUsed).toBe(false);
    expect(calls).toBe(0);
  });

  it("신분 서류는 켜지 않으면 모델에 보내지 않는다", async () => {
    delete process.env.ONB_AI_ID_DOCS;
    const bytes = bigPng();
    const r = await checkDocument({ field: "rep_passport_front", mime: "image/png", size: bytes.length, bytes });
    expect(calls).toBe(0);
    expect(r.aiUsed).toBe(false);
    expect(r.verdict).toBe("pass");
  });

  it("켜면 보낸다", async () => {
    process.env.ONB_AI_ID_DOCS = "1";
    reply = { verdict: "reject", reasons: ["masked"] };
    const bytes = bigPng();
    const r = await checkDocument({ field: "rep_passport_front", mime: "image/png", size: bytes.length, bytes });
    delete process.env.ONB_AI_ID_DOCS;
    expect(calls).toBe(1);
    expect(r.verdict).toBe("reject");
  });
});
