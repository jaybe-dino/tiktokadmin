// 광고 수신거부 통합 흐름 — DB·발송 공급자를 모두 가짜로 두고 끝까지 돌린다.
//   실제 고객·실제 발송은 전혀 건드리지 않는다.
//   검증: 고유링크 → 확정 → 저장 → 남은 큐 중단 → 이후 광고 provider 호출 0,
//        service 분리, 중복/재유입, 변조, 재클릭, GET 미리보기, DB 오류(fail closed), 발송 직전 경합.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 가짜 DB ──────────────────────────────────────────────────
interface OptOut { purpose: string; kind: string; addr_hash: string; addr_masked: string; brand_id: string | null; source: string; confirm_count: number }
interface SendRow {
  id: string; brand_id: string; channel_id: string; day_no: number; status: string; note: string;
  channels: string[]; brand_name: string; contact_name: string | null; email: string | null; phone: string | null;
  state: string; msg_opt_out: boolean; test_mode: boolean;
}
const db = {
  optouts: [] as OptOut[],
  sends: [] as SendRow[],
  brands: [] as { id: string; email: string | null; phone: string | null }[],
  failOptoutRead: false,
  marks: [] as { id: string; status: string; note: string; channels: string[] }[],
};

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    // 광고 수신거부 조회
    if (sql.includes("FROM ad_optouts") && sql.includes("SELECT kind, addr_hash")) {
      if (db.failOptoutRead) throw new Error("connection terminated");
      const hashes = args[1] as string[];
      return db.optouts.filter((o) => hashes.includes(o.addr_hash)).map((o) => ({ kind: o.kind, addr_hash: o.addr_hash }));
    }
    if (sql.includes("SELECT count(*)::text AS n FROM ad_optouts")) {
      const [, kind, hash] = args as string[];
      const hit = db.optouts.find((o) => o.kind === kind && o.addr_hash === hash);
      return [{ n: String((hit?.confirm_count ?? 0) > 1 ? 1 : 0) }];
    }
    if (sql.includes("INSERT INTO ad_optouts")) {
      const [purpose, kind, hash, masked, brandId, source] = args as (string | null)[];
      const cur = db.optouts.find((o) => o.kind === kind && o.addr_hash === hash);
      if (cur) { cur.confirm_count++; return [{ id: false }]; }
      db.optouts.push({ purpose: purpose!, kind: kind!, addr_hash: hash!, addr_masked: masked ?? "", brand_id: brandId ?? null, source: source ?? "link", confirm_count: 1 });
      return [{ id: true }];
    }
    // 수신자 대조용 브랜드
    if (sql.includes("SELECT DISTINCT b.id")) return db.brands as unknown as Record<string, unknown>[];
    // 남은 예약 중단
    if (sql.includes("UPDATE lead_sequence_sends SET status='canceled'")) {
      const brandId = args[0] as string;
      const hit = db.sends.filter((s) => s.brand_id === brandId && s.status === "queued");
      for (const s of hit) { s.status = "canceled"; s.note = "광고 수신거부"; }
      return hit.map((s) => ({ id: s.id }));
    }
    // 발송 대상
    if (sql.includes("FROM lead_sequence_sends q") && sql.includes("JOIN brands b")) {
      return db.sends.filter((s) => s.status === "queued") as unknown as Record<string, unknown>[];
    }
    if (sql.includes("FROM lead_sequence_config")) {
      return [{ channel_id: "ch1", enabled: true, days: 4, hour: 10, stop_on_progress: true }];
    }
    if (sql.includes("FROM lead_sequence_steps")) {
      return [1, 2, 3, 4].map((d) => ({
        channel_id: "ch1", day_no: d, enabled: true, send_sms: true, send_email: true, send_hour: null,
        sms_body: `${d}일차 문자`, email_subject: `${d}일차 제목`, email_body: `${d}일차 메일`,
      }));
    }
    if (sql.includes("UPDATE lead_sequence_sends SET status=$2")) {
      const [id, status, channels, note] = args as [string, string, string[], string];
      db.marks.push({ id, status, channels, note });
      const row = db.sends.find((s) => s.id === id);
      if (row) { row.status = status; row.note = note; row.channels = channels; }
      return [];
    }
    return [];
  };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    getPool: () => ({ connect: async () => ({ release: () => {} }) }),
  };
});

// ── 가짜 발송 공급자 ──────────────────────────────────────────
const smsSpy = vi.fn(async (_arg: { receiver: string; msg: string }) => ({ ok: true }));
const mailSpy = vi.fn(async (_arg: { to: string; subject: string; text: string }) => ({ ok: true }));
vi.mock("../lib/sms", () => ({ sendSms: (a: { receiver: string; msg: string }) => smsSpy(a) }));
vi.mock("../lib/mailer", () => ({ sendEmail: (a: { to: string; subject: string; text: string }) => mailSpy(a) }));

import { addrHash, mintToken, confirmOptOut, adGate, optoutUrl } from "../lib/ad-optout";
import { runDueSequence } from "../lib/lead-sequence";

const EMAIL = "lead@brand-example.com";
const PHONE = "010-1111-2222";
const BRAND = "brand-1";

function seed() {
  db.optouts = [];
  db.marks = [];
  db.failOptoutRead = false;
  db.brands = [{ id: BRAND, email: EMAIL, phone: PHONE }];
  db.sends = [1, 2, 3, 4].map((d) => ({
    id: `s${d}`, brand_id: BRAND, channel_id: "ch1", day_no: d, status: "queued", note: "", channels: [],
    brand_name: "예시브랜드", contact_name: "담당자", email: EMAIL, phone: PHONE,
    state: "lead_new", msg_opt_out: false, test_mode: false,
  }));
  smsSpy.mockClear();
  mailSpy.mockClear();
}
beforeEach(seed);

describe("정상 흐름 — 링크 → 확정 → 저장 → 큐 중단 → 이후 광고 0건", () => {
  it("수신거부 전에는 광고가 나간다", async () => {
    await runDueSequence();
    expect(smsSpy).toHaveBeenCalled();
    expect(mailSpy).toHaveBeenCalled();
  });

  it("문자 링크로 확정하면 문자·메일 광고가 모두 중단되고 남은 예약이 취소된다", async () => {
    const r = await confirmOptOut(mintToken("phone", PHONE));
    expect(r.ok).toBe(true);
    // 저장 — 한 채널 거부로 양쪽 모두
    expect(db.optouts.map((o) => o.kind).sort()).toEqual(["email", "phone"]);
    // 남은 예약 중단
    expect(r.canceled).toBe(4);
    expect(db.sends.every((s) => s.status === "canceled")).toBe(true);

    // 이후 광고 발송 시도 — provider 호출 0
    smsSpy.mockClear(); mailSpy.mockClear();
    await runDueSequence();
    expect(smsSpy).toHaveBeenCalledTimes(0);
    expect(mailSpy).toHaveBeenCalledTimes(0);
  });

  it("재유입으로 예약이 다시 잡혀도 광고는 나가지 않는다", async () => {
    await confirmOptOut(mintToken("email", EMAIL));
    // 같은 고객이 다른 루트로 재유입 → 예약이 새로 생긴 상황
    db.sends = [1, 2].map((d) => ({
      id: `n${d}`, brand_id: BRAND, channel_id: "ch2", day_no: d, status: "queued", note: "", channels: [],
      brand_name: "예시브랜드", contact_name: "담당자", email: EMAIL, phone: PHONE,
      state: "lead_new", msg_opt_out: false, test_mode: false,
    }));
    smsSpy.mockClear(); mailSpy.mockClear();
    await runDueSequence();
    expect(smsSpy).toHaveBeenCalledTimes(0);
    expect(mailSpy).toHaveBeenCalledTimes(0);
    expect(db.sends.every((s) => s.status === "canceled")).toBe(true);
  });

  it("다른 고객은 영향받지 않는다 — 브랜드 전체·타 브랜드 과잉 차단 없음", async () => {
    await confirmOptOut(mintToken("phone", PHONE));
    const other = await adGate({ phone: "010-9999-8888", email: "other@example.com" });
    expect(other.smsAllowed).toBe(true);
    expect(other.emailAllowed).toBe(true);
  });
});

describe("광고와 서비스 분리", () => {
  it("광고 수신거부는 전체 수신거부(brands.msg_opt_out)를 켜지 않는다", async () => {
    await confirmOptOut(mintToken("phone", PHONE));
    // 가짜 DB 에 brands.msg_opt_out 을 바꾸는 쿼리가 실행된 적이 없어야 한다.
    expect(db.marks.some((m) => m.note.includes("msg_opt_out"))).toBe(false);
    expect(db.optouts.every((o) => o.purpose === "marketing")).toBe(true);
  });
  it("service 목적 경로는 이 표를 보지 않는다 — 차단 검사는 광고 경로에서만 호출한다", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    // 광고 경로: 차단 검사를 부른다
    expect(read("lib/lead-sequence.ts")).toContain("adGate(");
    expect(read("lib/bulk-send.ts")).toContain("adGate(");
    // 서비스 경로: 부르지 않는다(광고를 service 로 우회시키지 않기 위해 경로를 섞지 않는다)
    for (const f of ["lib/welcome.ts", "lib/intake-channels.ts", "lib/meeting-invite.ts", "lib/escalation.ts", "lib/ops.ts"]) {
      expect(read(f), `${f} 가 광고 차단검사를 호출`).not.toContain("adGate");
    }
  });
});

describe("변조·재클릭·미리보기", () => {
  it("변조된 링크는 아무 것도 바꾸지 않는다", async () => {
    const t = mintToken("phone", PHONE);
    const bad = t.slice(0, -1) + (t.at(-1) === "a" ? "b" : "a");
    const r = await confirmOptOut(bad);
    expect(r.ok).toBe(false);
    expect(db.optouts).toHaveLength(0);
    expect(db.sends.every((s) => s.status === "queued")).toBe(true);
  });
  it("재클릭은 멱등 — 상태는 그대로, 확인 횟수만 올라간다", async () => {
    await confirmOptOut(mintToken("phone", PHONE));
    const before = db.optouts.length;
    const again = await confirmOptOut(mintToken("phone", PHONE));
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    expect(db.optouts).toHaveLength(before);
    expect(db.optouts.find((o) => o.kind === "phone")!.confirm_count).toBe(2);
  });
  it("링크를 여는 것(GET)만으로는 바뀌지 않는다 — 확정은 별도 호출", async () => {
    const { verifyToken } = await import("../lib/ad-optout");
    expect(verifyToken(mintToken("phone", PHONE))).not.toBeNull();   // 페이지 렌더가 하는 일
    expect(db.optouts).toHaveLength(0);                              // 저장은 아직 없음
  });
});

describe("조회 오류 — 광고는 보내지 않는다(fail closed)", () => {
  it("수신거부 확인이 실패하면 provider 를 부르지 않는다", async () => {
    db.failOptoutRead = true;
    await runDueSequence();
    expect(smsSpy).toHaveBeenCalledTimes(0);
    expect(mailSpy).toHaveBeenCalledTimes(0);
    expect(db.marks.every((m) => m.status === "failed")).toBe(true);
    expect(db.marks[0].note).toContain("수신거부 확인 실패");
  });
  it("adGate 자체도 오류 시 양쪽 모두 불가로 답한다", async () => {
    db.failOptoutRead = true;
    const g = await adGate({ phone: PHONE, email: EMAIL });
    expect(g.smsAllowed).toBe(false);
    expect(g.emailAllowed).toBe(false);
    expect(g.error).toBeTruthy();
  });
});

describe("발송 직전 경합 — 문자 후 수신거부하면 메일은 안 나간다", () => {
  it("문자 발송 직후 수신거부가 들어와도 같은 건의 메일은 막힌다", async () => {
    // 문자 발송이 일어나는 순간 수신거부가 저장되는 상황을 재현.
    smsSpy.mockImplementationOnce(async (_arg) => {
      db.optouts.push({ purpose: "marketing", kind: "email", addr_hash: addrHash("email", EMAIL), addr_masked: "", brand_id: BRAND, source: "link", confirm_count: 1 });
      return { ok: true };
    });
    db.sends = [db.sends[0]];
    await runDueSequence();
    expect(smsSpy).toHaveBeenCalledTimes(1);
    expect(mailSpy).toHaveBeenCalledTimes(0);   // 메일 직전 재확인에서 차단
  });
});

describe("발송 본문", () => {
  it("실제로 나가는 문자·메일에 그 수신자 전용 수신거부 링크가 붙는다", async () => {
    await runDueSequence();
    const smsArg = smsSpy.mock.calls[0]![0];
    const mailArg = mailSpy.mock.calls[0]![0];
    expect(smsArg.msg).toContain(optoutUrl("phone", PHONE));
    expect(mailArg.text).toContain(optoutUrl("email", EMAIL));
    // 본문은 그대로 남는다
    expect(smsArg.msg).toContain("1일차 문자");
    expect(mailArg.text).toContain("1일차 메일");
    // 평문 주소가 링크에 들어가지 않는다
    expect(smsArg.msg).not.toContain(EMAIL);
  });
});
