// 신규 리드 Slack 알림 — source 키가 라벨과 함께 보이는지.
//   DB·Slack 을 모두 가짜로 둔다. 실제 발송은 없다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { brand: null as Record<string, unknown> | null };
const posted: { text: string; blocks: unknown[] }[] = [];

vi.mock("../lib/db", () => ({
  query: async () => [],
  queryOne: async () => db.brand,
}));
vi.mock("../lib/slack", () => ({
  slackPost: async (i: { text: string; blocks: unknown[] }) => { posted.push(i); return { ok: true, ts: "1" }; },
}));
vi.mock("../lib/env", () => ({ env: { adminUrl: "https://admin.example.invalid" } }));

const N = await import("../lib/lead-notify");

/** 알림 블록에서 메모 섹션 본문을 뽑는다. 없으면 빈 문자열. */
function memoSection(): string {
  const blocks = (posted.at(-1)?.blocks ?? []) as { type: string; text?: { text?: string } }[];
  const sec = blocks.find((b) => b.type === "section" && (b.text?.text ?? "").startsWith("📝"));
  return sec?.text?.text ?? "";
}

/** 알림 블록에서 "📥 소스:" 줄만 뽑는다. */
function sourceLine(): string {
  const blocks = (posted.at(-1)?.blocks ?? []) as { type: string; elements?: { text?: string }[] }[];
  const ctx = blocks.find((b) => b.type === "context");
  return ctx?.elements?.[0]?.text ?? "";
}

const BRAND = {
  brand_name: "TEST 합성브랜드", contact_name: "TEST 담당자",
  email: "lead@example.invalid", phone: "01000000000",
  category: null, brand_url: null, source: "meta_ads", memo: null,
};

beforeEach(() => { posted.length = 0; db.brand = { ...BRAND }; });

describe("리드 알림의 source 표시", () => {
  it("source 키를 라벨과 함께 보여준다", async () => {
    await N.notifyNewLead("b1", { channelName: "9월 세미나", created: true });
    const line = sourceLine();
    expect(line).toContain("source:");
    expect(line).toContain("meta_ads");
    expect(line).toContain("9월 세미나");
  });

  it("유입 루트 이름과 source 를 섞지 않는다", async () => {
    await N.notifyNewLead("b1", { channelName: "9월 세미나", created: true });
    // 이름 · source: `키` 형태 — 어느 쪽이 키인지 보인다.
    expect(sourceLine()).toBe("📥 소스: 9월 세미나 · source: `meta_ads`");
  });

  it("루트 이름이 없으면 source 만 보여준다", async () => {
    await N.notifyNewLead("b1", {});
    expect(sourceLine()).toBe("📥 소스: source: `meta_ads`");
  });

  it("source 가 비어 있으면 미지정이라고 적는다(빈칸으로 두지 않는다)", async () => {
    db.brand = { ...BRAND, source: null };
    await N.notifyNewLead("b1", { channelName: "직접 등록" });
    expect(sourceLine()).toBe("📥 소스: 직접 등록 · source: _미지정_");
  });

  it("둘 다 없으면 직접 유입으로 적는다", async () => {
    db.brand = { ...BRAND, source: "" };
    await N.notifyNewLead("b1", {});
    expect(sourceLine()).toBe("📥 소스: 직접 유입 · source: _미지정_");
  });

  it("채널 인증키를 Slack 에 싣지 않는다", async () => {
    // notifyNewLead 는 intake_channels.key 를 받지도 조회하지도 않는다.
    const src = (await import("node:fs")).readFileSync(
      new URL("../lib/lead-notify.ts", import.meta.url), "utf8");
    const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    // intake_channels(인증키가 있는 표)를 조회하지 않는다.
    expect(code).not.toContain("intake_channels");
    // 브랜드 조회 칼럼은 source 까지만이다.
    expect(code).toContain("category, brand_url, source");
    // 알림에 넘기는 입력에도 인증키 자리가 없다.
    expect(code).not.toMatch(/channel_?[Kk]ey\s*\??:\s*string/);
    // slackPost 의 channelKey 는 "어느 Slack 채널에 올릴지"이지 유입 인증키가 아니다.
    expect(code).toContain('channelKey: "leads"');
  });
});

describe("리드 알림의 메모 표시", () => {
  it("훅으로 들어온 메모를 인용으로 함께 띄운다", async () => {
    db.brand = { ...BRAND, memo: "틱톡샵 입점 상담 원합니다. 예산은 월 300 정도예요." };
    await N.notifyNewLead("b1", { channelName: "9월 세미나" });
    const m = memoSection();
    expect(m).toContain("📝 *메모*");
    expect(m).toContain("틱톡샵 입점 상담 원합니다");
    expect(m).toContain(">");            // 인용 블록
  });

  it("메모가 없으면 블록을 아예 넣지 않는다", async () => {
    for (const v of [null, "", "   "]) {
      db.brand = { ...BRAND, memo: v };
      await N.notifyNewLead("b1", {});
      expect(memoSection(), JSON.stringify(v)).toBe("");
    }
  });

  it("여러 줄 메모는 줄마다 인용으로 붙인다", async () => {
    db.brand = { ...BRAND, memo: "첫 줄\n둘째 줄" };
    await N.notifyNewLead("b1", {});
    expect(memoSection()).toBe("📝 *메모*\n>첫 줄\n>둘째 줄");
  });

  it("고객이 쓴 멘션 문자가 채널 호출로 해석되지 않는다", async () => {
    db.brand = { ...BRAND, memo: "<!channel> 급해요 <@U12345> 확인 부탁 & 감사합니다" };
    await N.notifyNewLead("b1", {});
    const m = memoSection();
    // 꺾쇠가 남아 있으면 Slack 이 멘션으로 해석해 채널 전체가 호출된다.
    expect(m).not.toContain("<!channel>");
    expect(m).not.toContain("<@U12345>");
    expect(m).toContain("&lt;!channel&gt;");
    expect(m).toContain("&amp;");
    // 내용 자체는 읽을 수 있게 남는다.
    expect(m).toContain("급해요");
  });

  it("아주 긴 메모는 잘라서 넣는다(블록 한도를 넘기지 않게)", async () => {
    db.brand = { ...BRAND, memo: "가".repeat(3000) };
    await N.notifyNewLead("b1", {});
    const m = memoSection();
    expect(m).toContain("…(생략)");
    expect(m.length).toBeLessThan(1200);
  });

  it("메모 헬퍼는 단독으로도 같은 규칙을 따른다", async () => {
    expect(N.memoBlockText(null)).toBe("");
    expect(N.memoBlockText("  ")).toBe("");
    expect(N.memoBlockText("한 줄")).toBe("📝 *메모*\n>한 줄");
    expect(N.slackSafeText("a<b>c&d")).toBe("a&lt;b&gt;c&amp;d");
  });
});
