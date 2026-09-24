// 광고 수신거부 통합 흐름 — DB·발송 공급자를 모두 가짜로 두고 끝까지 돌린다.
//   실제 고객·실제 발송은 전혀 건드리지 않는다.
//   검증: 고유링크 → 확정 → 저장 → 남은 큐 중단 → 이후 광고 provider 호출 0,
//        service 분리, 중복/재유입, 변조, 재클릭, GET 미리보기, DB 오류(fail closed), 발송 직전 경합.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 가짜 DB ──────────────────────────────────────────────────
interface OptOut { purpose: string; kind: string; addr: string; addr_masked: string; brand_id: string | null; source: string; confirm_count: number }
interface Rcpt { id: string; token: string; email: string; phone: string; brand_id: string | null; kind: string }
interface SendRow {
  id: string; brand_id: string; channel_id: string; day_no: number; status: string; note: string;
  channels: string[]; brand_name: string; contact_name: string | null; email: string | null; phone: string | null;
  state: string; msg_opt_out: boolean; test_mode: boolean;
}
const db = {
  optouts: [] as OptOut[],
  rcpts: [] as Rcpt[],
  txFail: false,
  sends: [] as SendRow[],
  brands: [] as { id: string; email: string | null; phone: string | null }[],
  failOptoutRead: false,
  marks: [] as { id: string; status: string; note: string; channels: string[] }[],
};

vi.mock("../lib/db", () => {
  let seq = 0;
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    // 광고 수신거부 조회
    if (sql.includes("FROM ad_optouts") && sql.includes("SELECT kind, addr")) {
      if (db.failOptoutRead) throw new Error("connection terminated");
      const [, a, b] = args as string[];
      return db.optouts.filter((o) => (o.kind === "phone" && o.addr === a) || (o.kind === "email" && o.addr === b))
        .map((o) => ({ kind: o.kind, addr: o.addr, opted_out_at: "2026-09-24T00:00:00Z" }));
    }
    if (sql.includes("INSERT INTO ad_optouts")) {
      if (db.txFail) throw new Error("deadlock detected");
      const [purpose, kind, addr, masked, brandId, rcptId, source] = args as (string | null)[];
      const cur = db.optouts.find((o) => o.kind === kind && o.addr === addr);
      if (cur) { cur.confirm_count++; return [{ confirm_count: cur.confirm_count }]; }
      db.optouts.push({ purpose: purpose!, kind: kind!, addr: addr!, addr_masked: masked ?? "", brand_id: brandId ?? null, source: source ?? "link", confirm_count: 1 });
      return [{ confirm_count: 1 }];
    }
    // 수신자 발급/조회
    if (sql.includes("INSERT INTO ad_recipients")) {
      const [token, email, phone, brandId, kind] = args as (string | null)[];
      const hit = db.rcpts.find((r) => r.email === email && r.phone === phone);
      if (hit) return [hit as unknown as Record<string, unknown>];
      const row: Rcpt = { id: `r${++seq}`, token: token!, email: email ?? "", phone: phone ?? "", brand_id: brandId ?? null, kind: kind ?? "lead" };
      db.rcpts.push(row);
      return [row as unknown as Record<string, unknown>];
    }
    if (sql.includes("FROM ad_recipients WHERE token=")) {
      const hit = db.rcpts.find((r) => r.token === args[0]);
      return hit ? [hit as unknown as Record<string, unknown>] : [];
    }
    // 같은 연락처를 쓰는 브랜드 후보
    if (sql.includes("SELECT id, email, phone FROM brands")) {
      // 실제 SQL 과 같은 규칙: lower(trim(email)) 정확일치 · 숫자만 남긴 phone 의 꼬리 포함
      const [email, tail] = args as string[];
      return db.brands.filter((b) => (email && (b.email ?? "").trim().toLowerCase() === email)
        || (tail && (b.phone ?? "").replace(/[^0-9]/g, "").includes(tail))) as unknown as Record<string, unknown>[];
    }
    if (sql.includes("SELECT email, phone, COALESCE(msg_opt_out")) {
      const b = db.brands.find((x) => x.id === args[0]);
      return b ? [{ email: b.email, phone: b.phone, msg_opt_out: false }] : [];
    }
    // 남은 예약 중단
    if (sql.includes("UPDATE lead_sequence_sends SET status='canceled'")) {
      const ids = (args[0] as string[]) ?? [];
      const hit = db.sends.filter((s) => ids.includes(s.brand_id) && s.status === "queued");
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
  const client = {
    query: async (sql: string, args: unknown[] = []) => {
      const rows = await run(sql, args);
      return { rows, rowCount: rows.length };
    },
  };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    getPool: () => ({ connect: async () => ({ release: () => {} }) }),
    // 실제 tx 처럼 실패하면 전부 되돌린다(스냅샷 복원으로 흉내).
    tx: async <T,>(fn: (c: typeof client) => Promise<T>): Promise<T> => {
      const snap = { optouts: JSON.parse(JSON.stringify(db.optouts)), sends: JSON.parse(JSON.stringify(db.sends)) };
      try { return await fn(client); }
      catch (e) { db.optouts = snap.optouts; db.sends = snap.sends; throw e; }
    },
  };
});

// ── 가짜 발송 공급자 ──────────────────────────────────────────
const smsSpy = vi.fn(async (_arg: { receiver: string; msg: string }) => ({ ok: true }));
const mailSpy = vi.fn(async (_arg: { to: string; subject: string; text: string }) => ({ ok: true }));
vi.mock("../lib/sms", () => ({ sendSms: (a: { receiver: string; msg: string }) => smsSpy(a) }));
vi.mock("../lib/mailer", () => ({ sendEmail: (a: { to: string; subject: string; text: string }) => mailSpy(a) }));

import { ensureRecipient, recipientByToken, confirmOptOut, adGate, optoutUrlFor, normalizeAddr } from "../lib/ad-optout";
import { runDueSequence } from "../lib/lead-sequence";

const EMAIL = "lead@brand-example.com";
const PHONE = "010-1111-2222";
const BRAND = "brand-1";

function seed() {
  db.optouts = [];
  db.rcpts = [];
  db.txFail = false;
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

/** 이 수신자의 링크 토큰(실제 발송 경로와 같은 방식으로 발급). */
async function tokenFor(email = EMAIL, phone = PHONE): Promise<string> {
  const r = await ensureRecipient({ email, phone, brandId: BRAND });
  return r!.token;
}

describe("정상 흐름 — 링크 → 확정 → 저장 → 큐 중단 → 이후 광고 0건", () => {
  it("수신거부 전에는 광고가 나간다", async () => {
    await runDueSequence();
    expect(smsSpy).toHaveBeenCalled();
    expect(mailSpy).toHaveBeenCalled();
  });

  it("문자 링크로 확정하면 문자·메일 광고가 모두 중단되고 남은 예약이 취소된다", async () => {
    const r = await confirmOptOut(await tokenFor());
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
    await confirmOptOut(await tokenFor());
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
    await confirmOptOut(await tokenFor());
    const other = await adGate({ phone: "010-9999-8888", email: "other@example.com" });
    expect(other.smsAllowed).toBe(true);
    expect(other.emailAllowed).toBe(true);
  });
});

describe("광고와 서비스 분리", () => {
  it("광고 수신거부는 전체 수신거부(brands.msg_opt_out)를 켜지 않는다", async () => {
    await confirmOptOut(await tokenFor());
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
    const t = await tokenFor();
    const bad = t.slice(0, -1) + (t.at(-1) === "A" ? "B" : "A");
    const r = await confirmOptOut(bad);
    expect(r.ok).toBe(false);
    expect(db.optouts).toHaveLength(0);
    expect(db.sends.every((s) => s.status === "queued")).toBe(true);
  });
  it("재클릭은 멱등 — 상태는 그대로, 확인 횟수만 올라간다", async () => {
    const t = await tokenFor();
    await confirmOptOut(t);
    const before = db.optouts.length;
    const again = await confirmOptOut(t);
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    expect(db.optouts).toHaveLength(before);
    expect(db.optouts.find((o) => o.kind === "phone")!.confirm_count).toBe(2);
    expect(db.optouts.find((o) => o.kind === "email")!.confirm_count).toBe(2);
  });
  it("링크를 여는 것(GET)만으로는 바뀌지 않는다 — 확정은 별도 호출", async () => {
    expect(await recipientByToken(await tokenFor())).not.toBeNull();   // 페이지 렌더가 하는 일
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
      db.optouts.push({ purpose: "marketing", kind: "email", addr: normalizeAddr("email", EMAIL), addr_masked: "", brand_id: BRAND, source: "link", confirm_count: 1 });
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
    const t = await tokenFor();
    expect(smsArg.msg).toContain(optoutUrlFor(t));
    expect(mailArg.text).toContain(optoutUrlFor(t));   // 같은 수신자 → 같은 링크
    // 본문은 그대로 남는다
    expect(smsArg.msg).toContain("1일차 문자");
    expect(mailArg.text).toContain("1일차 메일");
    // 평문 주소가 링크에 들어가지 않는다
    expect(smsArg.msg).not.toContain(EMAIL);
  });
});

// ── Codex 지적 회귀 ──────────────────────────────────────────
describe("회귀 — 확정은 전부 성공하거나 전부 되돌아간다", () => {
  it("저장 중 오류가 나면 수신거부·큐중단 모두 남지 않고 실패로 보고한다", async () => {
    db.txFail = true;
    const r = await confirmOptOut(await tokenFor());
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(db.optouts).toHaveLength(0);                       // 부분 저장 없음
    expect(db.sends.every((s) => s.status === "queued")).toBe(true);
  });
  it("공개 화면에 DB 원문 오류를 돌려주지 않는다", async () => {
    db.txFail = true;
    const r = await confirmOptOut(await tokenFor());
    expect(r.error).not.toContain("deadlock");
    expect(r.error).not.toContain(EMAIL);
    expect(r.error).not.toContain(PHONE.replace(/-/g, ""));
  });
});

describe("회귀 — 중복 브랜드·재등록", () => {
  it("같은 연락처를 쓰는 다른 브랜드의 예약도 함께 중단된다", async () => {
    db.brands.push({ id: "brand-2", email: EMAIL, phone: PHONE });
    db.sends.push({
      id: "s9", brand_id: "brand-2", channel_id: "ch2", day_no: 1, status: "queued", note: "", channels: [],
      brand_name: "중복유입", contact_name: null, email: EMAIL, phone: PHONE,
      state: "lead_new", msg_opt_out: false, test_mode: false,
    });
    const r = await confirmOptOut(await tokenFor());
    expect(r.canceled).toBe(5);                               // 4 + 1
    expect(db.sends.every((s) => s.status === "canceled")).toBe(true);
  });
  it("수신거부한 연락처로 새로 유입돼도 예약이 잡히지 않는다", async () => {
    await confirmOptOut(await tokenFor());
    const { enrollLead } = await import("../lib/lead-sequence");
    const r = await enrollLead(BRAND, "ch1");
    expect(r.scheduled).toBe(0);
    expect(r.skipped).toContain("수신거부");
  });
});

describe("회귀 — 판정 단위는 수신자(이메일·전화 쌍)", () => {
  it("메일만 거부돼 있어도 같은 수신자의 문자까지 함께 막힌다", async () => {
    db.optouts.push({ purpose: "marketing", kind: "email", addr: normalizeAddr("email", EMAIL), addr_masked: "", brand_id: BRAND, source: "link", confirm_count: 1 });
    db.sends = [db.sends[0]];
    await runDueSequence();
    expect(smsSpy).toHaveBeenCalledTimes(0);
    expect(mailSpy).toHaveBeenCalledTimes(0);
    expect(db.sends[0].status).toBe("canceled");
  });

  it("거부한 전화를 그대로 둔 채 새 이메일을 붙여도 우회되지 않는다", async () => {
    await confirmOptOut(await tokenFor());
    const g = await adGate({ phone: PHONE, email: "new-address@example.com" });
    expect(g.smsAllowed).toBe(false);
    expect(g.emailAllowed).toBe(false);

    // 같은 전화 + 새 이메일로 다시 유입돼도 예약이 잡히지 않는다.
    db.brands = [{ id: BRAND, email: "new-address@example.com", phone: PHONE }];
    db.sends = [];
    const { enrollLead } = await import("../lib/lead-sequence");
    const r = await enrollLead(BRAND, "ch1");
    expect(r.scheduled).toBe(0);
    expect(r.skipped).toContain("수신거부");
  });

  it("거부한 이메일을 그대로 둔 채 새 전화를 붙여도 우회되지 않는다", async () => {
    await confirmOptOut(await tokenFor());
    const g = await adGate({ phone: "010-7777-6666", email: EMAIL });
    expect(g.smsAllowed).toBe(false);
    expect(g.emailAllowed).toBe(false);
  });

  it("무관한 다른 연락처 쌍은 그대로 발송된다", async () => {
    await confirmOptOut(await tokenFor());
    const g = await adGate({ phone: "010-3333-4444", email: "someone-else@example.com" });
    expect(g.smsAllowed).toBe(true);
    expect(g.emailAllowed).toBe(true);
  });
});

describe("회귀 — 저장 표기가 달라도 같은 사람의 예약을 찾는다", () => {
  it("전화가 '+82 10-...' 하이픈 국제표기로 저장된 중복 브랜드의 큐도 함께 중단된다", async () => {
    db.brands.push({ id: "brand-intl", email: null, phone: "+82 10-1111-2222" });
    db.sends.push({
      id: "s-intl", brand_id: "brand-intl", channel_id: "ch2", day_no: 1, status: "queued", note: "", channels: [],
      brand_name: "국제표기", contact_name: null, email: null, phone: "+82 10-1111-2222",
      state: "lead_new", msg_opt_out: false, test_mode: false,
    });
    const r = await confirmOptOut(await tokenFor());
    expect(r.ok).toBe(true);
    expect(db.sends.find((s) => s.id === "s-intl")!.status).toBe("canceled");
    expect(r.canceled).toBe(5);                               // 원래 4 + 국제표기 1
  });

  it("이메일이 앞뒤 공백·대문자로 저장된 중복 브랜드의 큐도 함께 중단된다", async () => {
    db.brands.push({ id: "brand-pad", email: `  ${EMAIL.toUpperCase()} `, phone: null });
    db.sends.push({
      id: "s-pad", brand_id: "brand-pad", channel_id: "ch2", day_no: 1, status: "queued", note: "", channels: [],
      brand_name: "공백표기", contact_name: null, email: `  ${EMAIL.toUpperCase()} `, phone: null,
      state: "lead_new", msg_opt_out: false, test_mode: false,
    });
    const r = await confirmOptOut(await tokenFor());
    expect(db.sends.find((s) => s.id === "s-pad")!.status).toBe("canceled");
    expect(r.canceled).toBe(5);
  });
});
