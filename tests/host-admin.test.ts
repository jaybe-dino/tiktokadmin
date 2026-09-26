// 회의 호스트 → 담당자(admin_users) 자동 지정 규칙.
//   틀리면 남의 회의가 남에게 붙으므로, 조건이 좁게 유지되는지 고정한다.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Admin { id: string; name: string; active: boolean; zoom_email: string | null }
interface Mtg { id: string; host_email: string | null; host_admin_id: string | null; brand_id: string | null; transcript: string | null }

const db = { admins: [] as Admin[], meetings: [] as Mtg[] };

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const a = args as (string | null)[];
    if (sql.includes("SELECT id FROM admin_users") && sql.includes("active = true")) {
      return db.admins.filter((x) => x.active && norm(x.zoom_email) === a[0]).slice(0, 2).map((x) => ({ id: x.id }));
    }
    if (sql.includes("SELECT id, active, zoom_email FROM admin_users WHERE id=")) {
      const x = db.admins.find((v) => v.id === a[0]);
      return x ? [{ id: x.id, active: x.active, zoom_email: x.zoom_email }] : [];
    }
    if (sql.includes("UPDATE meetings SET host_admin_id = $1")) {
      const hit = db.meetings.filter((m) => m.host_admin_id === null && norm(m.host_email) === a[1]);
      for (const m of hit) m.host_admin_id = String(a[0]);
      return hit.map((m) => ({ id: m.id }));
    }
    return [];
  };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    getPool: () => ({ connect: async () => ({ release: () => {} }) }),
  };
});

import { normalizeZoomEmail, resolveHostAdmin, backfillHostAdminForAccount } from "../lib/host-admin";

const JIHO = "jhkim84@dinostudio.kr";
const REP = "jaybe@dinostudio.kr";

beforeEach(() => {
  db.admins = [
    { id: JIHO, name: "김지호", active: true, zoom_email: JIHO },
    { id: REP, name: "대표", active: true, zoom_email: REP },
  ];
  db.meetings = [];
});

describe("호스트 → 담당자 매칭", () => {
  it("활성 계정의 정확 일치 하나면 지정한다", async () => {
    expect(await resolveHostAdmin(JIHO)).toBe(JIHO);
  });
  it("대소문자·공백이 달라도 같은 계정으로 본다", async () => {
    expect(await resolveHostAdmin("  JHKim84@DinoStudio.KR ")).toBe(JIHO);
    expect(normalizeZoomEmail(" A@B.KR ")).toBe("a@b.kr");
  });
  it("호스트 이메일이 없으면 지정하지 않는다", async () => {
    expect(await resolveHostAdmin(null)).toBeNull();
    expect(await resolveHostAdmin("   ")).toBeNull();
  });
  it("비활성 계정에는 붙이지 않는다", async () => {
    db.admins[0].active = false;
    expect(await resolveHostAdmin(JIHO)).toBeNull();
  });
  it("같은 Zoom 이메일을 쓰는 활성 계정이 둘이면 지정하지 않는다(불명확)", async () => {
    db.admins.push({ id: "dup@dinostudio.kr", name: "중복", active: true, zoom_email: JIHO });
    expect(await resolveHostAdmin(JIHO)).toBeNull();
  });
  it("부분 일치로 붙이지 않는다", async () => {
    expect(await resolveHostAdmin("jhkim84@dinostudio.kr.attacker.com")).toBeNull();
    expect(await resolveHostAdmin("jhkim84")).toBeNull();
  });
  it("등록되지 않은 호스트는 비워 둔다", async () => {
    expect(await resolveHostAdmin("someone-else@example.com")).toBeNull();
  });
});

describe("계정 저장 시 과거 회의 보충", () => {
  const mtg = (p: Partial<Mtg>): Mtg =>
    ({ id: `m${db.meetings.length + 1}`, host_email: JIHO, host_admin_id: null, brand_id: null, transcript: null, ...p });

  it("담당자가 비어 있는 과거 회의만 채운다", async () => {
    db.meetings = [mtg({}), mtg({}), mtg({ host_email: REP })];
    const r = await backfillHostAdminForAccount(JIHO);
    expect(r.updated).toBe(2);
    expect(db.meetings[0].host_admin_id).toBe(JIHO);
    expect(db.meetings[2].host_admin_id).toBeNull();     // 다른 호스트 회의는 그대로
  });

  it("이미 지정된 담당자는 덮어쓰지 않는다", async () => {
    db.meetings = [mtg({ host_admin_id: REP }), mtg({})];
    const r = await backfillHostAdminForAccount(JIHO);
    expect(r.updated).toBe(1);
    expect(db.meetings[0].host_admin_id).toBe(REP);      // 보존
    expect(db.meetings[1].host_admin_id).toBe(JIHO);
  });

  it("표기가 달라도(대문자·공백) 같은 호스트로 본다", async () => {
    db.meetings = [mtg({ host_email: "  JHKIM84@dinostudio.kr  " })];
    expect((await backfillHostAdminForAccount(JIHO)).updated).toBe(1);
  });

  it("Zoom 이메일이 비어 있으면 아무 것도 하지 않는다", async () => {
    db.admins[0].zoom_email = null;
    db.meetings = [mtg({})];
    const r = await backfillHostAdminForAccount(JIHO);
    expect(r.updated).toBe(0);
    expect(r.skipped).toContain("Zoom 이메일");
    expect(db.meetings[0].host_admin_id).toBeNull();
  });

  it("비활성 계정은 보충하지 않는다", async () => {
    db.admins[0].active = false;
    db.meetings = [mtg({})];
    const r = await backfillHostAdminForAccount(JIHO);
    expect(r.updated).toBe(0);
    expect(r.skipped).toContain("비활성");
  });

  it("같은 Zoom 이메일을 쓰는 활성 계정이 여럿이면 자동 지정하지 않는다", async () => {
    db.admins.push({ id: "dup@dinostudio.kr", name: "중복", active: true, zoom_email: JIHO });
    db.meetings = [mtg({})];
    const r = await backfillHostAdminForAccount(JIHO);
    expect(r.updated).toBe(0);
    expect(r.skipped).toContain("여럿");
    expect(db.meetings[0].host_admin_id).toBeNull();
  });

  it("없는 계정이면 사유를 알린다", async () => {
    const r = await backfillHostAdminForAccount("nobody@example.com");
    expect(r.updated).toBe(0);
    expect(r.skipped).toContain("찾을 수 없");
  });

  it("브랜드 지정·전사는 건드리지 않는다", async () => {
    db.meetings = [mtg({ brand_id: "brand-1", transcript: "기존 전사" })];
    await backfillHostAdminForAccount(JIHO);
    expect(db.meetings[0].brand_id).toBe("brand-1");
    expect(db.meetings[0].transcript).toBe("기존 전사");
  });

  it("두 번 돌려도 같은 결과(멱등)", async () => {
    db.meetings = [mtg({})];
    expect((await backfillHostAdminForAccount(JIHO)).updated).toBe(1);
    expect((await backfillHostAdminForAccount(JIHO)).updated).toBe(0);
  });
});
