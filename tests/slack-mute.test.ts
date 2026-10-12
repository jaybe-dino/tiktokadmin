// Slack 채널 일시 중지 — SLACK_MUTED_CHANNELS.
//   네트워크를 타지 않고, 멈춘 채널로는 chat.postMessage 가 아예 불리지 않는지 본다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls: { url: string; channel: string }[] = [];

vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
  const body = JSON.parse(init.body) as { channel: string };
  calls.push({ url: String(url), channel: body.channel });
  return { json: async () => ({ ok: true, ts: "111.222" }) } as unknown as Response;
});

vi.mock("../lib/env", () => ({
  env: { slack: { botToken: "xoxb-test" } },
  // sla 는 전용 채널이 없으면 daily 로 흘러간다 — 실제 매핑과 같은 규칙.
  slackChannel: (key: string) => ({
    daily: "#glovek-daily",
    leads: "#glovek-lead",
    sla: "#glovek-daily",
  } as Record<string, string>)[key] ?? "",
}));

const S = await import("../lib/slack");

beforeEach(() => { calls.length = 0; delete process.env.SLACK_MUTED_CHANNELS; });
afterEach(() => { delete process.env.SLACK_MUTED_CHANNELS; });

describe("채널 일시 중지", () => {
  it("설정이 없으면 평소대로 보낸다", async () => {
    const r = await S.slackPost({ channelKey: "daily", text: "안녕" });
    expect(r.ok).toBe(true);
    expect(r.muted).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("채널 키로 멈추면 보내지 않는다", async () => {
    process.env.SLACK_MUTED_CHANNELS = "daily";
    const r = await S.slackPost({ channelKey: "daily", text: "안녕" });
    expect(r.ok).toBe(false);
    expect(r.muted).toBe(true);
    expect(calls).toHaveLength(0);   // 네트워크 호출 자체가 없다
  });

  it("실제 채널 이름으로도 멈춘다(#, 대소문자, 공백 무시)", async () => {
    for (const v of ["#glovek-daily", "glovek-daily", " #GloveK-Daily "]) {
      process.env.SLACK_MUTED_CHANNELS = v;
      calls.length = 0;
      const r = await S.slackPost({ channelKey: "daily", text: "안녕" });
      expect(r.muted, v).toBe(true);
      expect(calls, v).toHaveLength(0);
    }
  });

  it("같은 채널로 흘러드는 다른 알림(sla 폴백)도 함께 멈춘다", async () => {
    process.env.SLACK_MUTED_CHANNELS = "glovek-daily";
    // sla 는 전용 채널이 없어 daily 로 간다 — 키만 보고 막으면 이 경로가 샌다.
    const r = await S.slackPost({ channelKey: "sla", text: "SLA 초과" });
    expect(r.muted).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("멈추지 않은 채널은 영향받지 않는다", async () => {
    process.env.SLACK_MUTED_CHANNELS = "daily";
    const r = await S.slackPost({ channelKey: "leads", text: "신규 리드" });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].channel).toBe("#glovek-lead");
  });

  it("여러 채널을 한 번에 멈출 수 있다", async () => {
    process.env.SLACK_MUTED_CHANNELS = "daily, leads";
    expect((await S.slackPost({ channelKey: "daily" })).muted).toBe(true);
    expect((await S.slackPost({ channelKey: "leads" })).muted).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("멈춘 채널에는 기존 글 수정도 하지 않는다", async () => {
    process.env.SLACK_MUTED_CHANNELS = "glovek-daily";
    await S.slackUpdate("#glovek-daily", "111.222", { text: "고침" });
    expect(calls).toHaveLength(0);
  });

  it("해제하면 바로 다시 나간다(쌓아 뒀다 몰아 보내지 않는다)", async () => {
    process.env.SLACK_MUTED_CHANNELS = "daily";
    await S.slackPost({ channelKey: "daily", text: "멈춘 동안 1" });
    await S.slackPost({ channelKey: "daily", text: "멈춘 동안 2" });
    expect(calls).toHaveLength(0);

    delete process.env.SLACK_MUTED_CHANNELS;
    const r = await S.slackPost({ channelKey: "daily", text: "해제 후" });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);   // 밀린 2건이 몰려 나가지 않는다
  });

  it("빈 값·쉼표만 있으면 아무것도 멈추지 않는다", async () => {
    for (const v of ["", "   ", ",,"]) {
      process.env.SLACK_MUTED_CHANNELS = v;
      expect(S.isChannelMuted("daily"), JSON.stringify(v)).toBe(false);
    }
  });
});
