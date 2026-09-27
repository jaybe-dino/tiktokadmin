// PM 브랜드 접근 통제 — 배정되지 않은 직원 거부, 타 브랜드 하위 ID 거부, 권한 확장 차단.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface BrandRow {
  id: string; brand_name: string; is_test: boolean;
  owner_intake: string | null; owner_sales: string | null; owner_onboard: string | null;
  owner_ads: string | null; owner_contract: string | null; owner_backup: string | null;
  pm_owner: string | null;
}
const db = {
  brands: [] as BrandRow[],
  rows: { pm_tasks: [] as { id: string; brand_id: string }[], pm_kpis: [] as { id: string; brand_id: string }[] },
  user: null as { id: string; name: string; role: string; active: boolean } | null,
  pmTableMissing: false,
};

vi.mock("../lib/auth", () => ({ currentUser: async () => db.user }));
vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const a = args as string[];
    if (sql.includes("LEFT JOIN pm_brand_config")) {
      if (db.pmTableMissing) throw new Error('relation "pm_brand_config" does not exist');
      const b = db.brands.find((x) => x.id === a[0]);
      return b ? [b as unknown as Record<string, unknown>] : [];
    }
    if (sql.includes("FROM brands b WHERE b.id=")) {
      const b = db.brands.find((x) => x.id === a[0]);
      return b ? [{ ...b, pm_owner: undefined } as unknown as Record<string, unknown>] : [];
    }
    const m = sql.match(/FROM (pm_tasks|pm_kpis) WHERE id=\$1 AND brand_id=\$2/);
    if (m) {
      const list = db.rows[m[1] as "pm_tasks" | "pm_kpis"];
      const hit = list.find((r) => r.id === a[0] && r.brand_id === a[1]);
      return hit ? [{ id: hit.id }] : [];
    }
    return [];
  };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    getPool: () => ({ connect: async () => ({ release: () => {} }) }),
  };
});

import { brandAccess, guard, ownsRow, isUuid } from "../lib/pm-access";

const B1 = "11111111-1111-4111-8111-111111111111";
const B2 = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const brand = (id: string, over: Partial<BrandRow> = {}): BrandRow => ({
  id, brand_name: `브랜드${id.slice(0, 2)}`, is_test: false,
  owner_intake: null, owner_sales: null, owner_onboard: null,
  owner_ads: null, owner_contract: null, owner_backup: null, pm_owner: null, ...over,
});

beforeEach(() => {
  db.brands = [brand(B1, { owner_sales: "sales@dinostudio.kr" }), brand(B2, { owner_ads: "ads@dinostudio.kr" })];
  db.rows = { pm_tasks: [{ id: T1, brand_id: B1 }, { id: T2, brand_id: B2 }], pm_kpis: [] };
  db.user = { id: "sales@dinostudio.kr", name: "영업", role: "sales", active: true };
  db.pmTableMissing = false;
});

describe("브랜드 접근 — 배정 기준", () => {
  it("배정된 담당자는 접근할 수 있다", async () => {
    const r = await brandAccess(B1);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.access.via).toBe("brand_owner"); expect(r.access.canAssignPm).toBe(true); }
  });

  it("배정되지 않은 직원은 읽기도 거부된다", async () => {
    const r = await brandAccess(B2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("담당자가 아닙니다");
  });

  it("대표·파트장은 모든 브랜드에 접근한다", async () => {
    for (const role of ["exec", "lead"]) {
      db.user = { id: "boss@dinostudio.kr", name: "대표", role, active: true };
      const r = await brandAccess(B2);
      expect(r.ok, role).toBe(true);
      if (r.ok) expect(r.access.via).toBe("global");
    }
  });

  it("PM 담당자로 지정되면 접근은 되지만 담당자 지정 권한은 없다(권한 확장 차단)", async () => {
    db.brands = [brand(B2, { pm_owner: "ads2@dinostudio.kr" })];
    db.user = { id: "ads2@dinostudio.kr", name: "광고", role: "ads", active: true };
    const r = await brandAccess(B2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.access.via).toBe("pm_owner");
      expect(r.access.canAssignPm).toBe(false);
    }
  });

  it("로그인하지 않았거나 비활성 계정은 거부", async () => {
    db.user = null;
    expect((await brandAccess(B1)).ok).toBe(false);
    db.user = { id: "sales@dinostudio.kr", name: "영업", role: "sales", active: false };
    expect((await brandAccess(B1)).ok).toBe(false);
  });

  it("없는 브랜드·형식이 아닌 id 는 거부", async () => {
    expect((await brandAccess("not-a-uuid")).ok).toBe(false);
    expect((await brandAccess("33333333-3333-4333-8333-333333333333")).ok).toBe(false);
  });

  it("0099 미적용이면 PM 담당자 경유 접근 없이 배정 기준만 쓴다", async () => {
    db.pmTableMissing = true;
    const ok = await brandAccess(B1);
    expect(ok.ok).toBe(true);
    const no = await brandAccess(B2);
    expect(no.ok).toBe(false);
  });

  it("uuid 형식 검사", () => {
    expect(isUuid(B1)).toBe(true);
    expect(isUuid("1234")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("하위 ID 혼입 차단", () => {
  it("다른 브랜드의 업무 id 는 거부한다", async () => {
    expect(await ownsRow("pm_tasks", T2, B1)).toBe(false);
    expect(await ownsRow("pm_tasks", T1, B1)).toBe(true);
  });

  it("guard 는 접근과 소유를 함께 본다", async () => {
    const good = await guard(B1, { table: "pm_tasks", id: T1 });
    expect(good.ok).toBe(true);
    const mixed = await guard(B1, { table: "pm_tasks", id: T2 });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.error).toContain("이 브랜드의 항목이 아닙니다");
  });

  it("접근이 막힌 브랜드면 소유 확인 전에 거부된다", async () => {
    const r = await guard(B2, { table: "pm_tasks", id: T2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("담당자가 아닙니다");
  });

  it("형식이 아닌 하위 id 는 거부", async () => {
    expect(await ownsRow("pm_tasks", "x", B1)).toBe(false);
  });
});
