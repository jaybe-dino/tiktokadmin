// 유입 즉시 자동 안내 — 브랜드 전체 수신거부면 보내지 않는다.
//   DB·문자·메일 공급자를 모두 가짜로 둔다. 실제 고객·실제 발송은 건드리지 않는다.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Brand {
  id: string; brand_name: string; contact_name: string | null;
  email: string | null; phone: string | null;
  welcome_sent_at: string | null; msg_opt_out: boolean;
}
const db = {
  brands: [] as Brand[],
  smsSent: [] as { to: string }[],
  mailSent: [] as { to: string }[],
  marked: [] as string[],
};

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    if (sql.includes("FROM brands WHERE id=")) {
      const b = db.brands.find((x) => x.id === args[0]);
      return b ? [b as unknown as Record<string, unknown>] : [];
    }
    if (sql.includes("welcome_sent_at")  && sql.startsWith("UPDATE brands")) {
      db.marked.push(String(args[0] ?? ""));
      return [];
    }
    if (sql.includes("FROM welcome_config")) {
      return [{
        enabled: true, sources: ["web"], send_sms: true, send_email: true,
        sms_template: "안녕하세요 {브랜드명}", email_subject: "안내", email_body: "본문",
      }];
    }
    if (sql.startsWith("UPDATE")) return [];
    if (sql.startsWith("INSERT")) return [];
    return [];
  };
  return {
    query: run,
    queryOne: async (s: string, a?: unknown[]) => (await run(s, a))[0] ?? null,
  };
});
vi.mock("../lib/sms", () => ({
  sendSms: async (i: { receiver: string }) => { db.smsSent.push({ to: i.receiver }); return { ok: true }; },
}));
vi.mock("../lib/mailer", () => ({
  sendEmail: async (i: { to: string }) => { db.mailSent.push({ to: i.to }); return { ok: true }; },
}));
vi.mock("../lib/templates", () => ({
  getTemplate: async () => null,
  renderTemplate: (b: string) => b,
}));

const W = await import("../lib/welcome");
const IC = await import("../lib/intake-channels");

const BRAND: Brand = {
  id: "b1", brand_name: "TEST 합성브랜드", contact_name: "TEST 담당자",
  email: "lead@example.invalid", phone: "01000000000",
  welcome_sent_at: null, msg_opt_out: false,
};
const CHANNEL = {
  id: "c1", key: "web", name: "TEST 루트", enabled: true,
  send_sms: true, send_email: true,
  sms_template: "안녕하세요 {브랜드명}", email_subject: "안내", email_body: "본문",
} as unknown as Parameters<typeof IC.sendChannelWelcome>[1];

beforeEach(() => {
  db.brands = [{ ...BRAND }];
  db.smsSent = []; db.mailSent = []; db.marked = [];
});

describe("유입 즉시 자동 안내 · 전체 수신거부", () => {
  it("수신거부가 아니면 평소처럼 나간다", async () => {
    const r = await W.sendWelcome("b1");
    expect(r.ok).toBe(true);
    expect(r.skipped).toBeUndefined();
    expect(db.smsSent.length + db.mailSent.length).toBeGreaterThan(0);
  });

  it("전체 수신거부면 sendWelcome 이 아무것도 보내지 않는다", async () => {
    db.brands[0].msg_opt_out = true;
    const r = await W.sendWelcome("b1");
    expect(r.ok).toBe(true);
    expect(r.sent).toEqual([]);
    expect(r.skipped ?? "").toContain("수신거부");
    expect(db.smsSent).toHaveLength(0);
    expect(db.mailSent).toHaveLength(0);
  });

  it("수동 강제 발송(force)으로도 수신거부는 뚫리지 않는다", async () => {
    db.brands[0].msg_opt_out = true;
    db.brands[0].welcome_sent_at = null;
    const r = await W.sendWelcome("b1", true);
    expect(r.sent).toEqual([]);
    expect(r.skipped ?? "").toContain("수신거부");
    expect(db.smsSent).toHaveLength(0);
    expect(db.mailSent).toHaveLength(0);
  });

  it("유입 루트 자동 안내도 수신거부면 보내지 않고 사유를 알려준다", async () => {
    db.brands[0].msg_opt_out = true;
    const r = await IC.sendChannelWelcome("b1", CHANNEL);
    expect(r.optedOut).toBe(true);
    expect(r.sent).toEqual([]);
    expect(r.smsAttempted).toBe(false);
    expect(r.emailAttempted).toBe(false);
    expect(db.smsSent).toHaveLength(0);
    expect(db.mailSent).toHaveLength(0);
  });

  it("수신거부가 아니면 유입 루트 자동 안내는 그대로 나간다", async () => {
    const r = await IC.sendChannelWelcome("b1", CHANNEL);
    expect(r.optedOut).toBe(false);
    expect(db.smsSent.length + db.mailSent.length).toBeGreaterThan(0);
  });
});
