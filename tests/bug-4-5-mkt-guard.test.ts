// BUG-4 — "마케팅 캠페인 등록시 어플리케이션 오류".
//   원인: /mkt 서버액션이 화면에서 받은 id 를 그대로 Postgres 에 넘겼다. uuid 가 아니면
//   "invalid input syntax for type uuid" 예외가 서버액션 밖으로 올라가 Next 가 화면을
//   통째로 "Application error" 로 바꿔 버린다. 이제 먼저 걸러 읽을 수 있는 메시지를 준다.
// BUG-5 — "브랜드 오류 연결 수정 필요": 잘못 연결된 브랜드를 바꾸는 경로가 실제로 동작하는지 고정.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// uuid 가 아닌 값이 DB 까지 가면 이 가짜 드라이버가 실제 Postgres 처럼 던진다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let seen: { sql: string; params: unknown[] }[] = [];
function guardParams(sql: string, params: unknown[] = []) {
  seen.push({ sql, params });
  if (/\bid\s*=\s*\$1/.test(sql) || /brand_id\s*=\s*\$[12]/.test(sql)) {
    for (const v of params) {
      if (typeof v === "string" && v.length > 0 && !UUID.test(v) && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new Error(`invalid input syntax for type uuid: "${v}"`);
      }
    }
  }
}
vi.mock("@/lib/auth", () => ({ currentUser: async () => ({ id: "u1", role: "lead", name: "테스트" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string, params?: unknown[]) => { guardParams(sql, params); return []; },
  queryOne: async (sql: string, params?: unknown[]) => { guardParams(sql, params); return null; },
}));
vi.mock("@/lib/service-tags", () => ({ syncServiceTags: async () => {} }));
vi.mock("@/lib/pm-access", async () => await import("../lib/pm-access"));

const A = await import("../app/(dash)/mkt/actions");
const BAD = "not-a-uuid";
const screen = readFileSync(new URL("../components/MktScreen.tsx", import.meta.url), "utf8");

beforeEach(() => { seen = []; });

describe("BUG-4 — 잘못된 id 가 와도 화면이 죽지 않는다", () => {
  it("프로젝트(캠페인) 등록 — 브랜드 값이 깨져 있으면 읽을 수 있는 오류", async () => {
    const r = await A.createMktProjectAction({ brand_id: BAD, title: "11월 캠페인" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("브랜드");
    // DB 까지 가지 않았다 — 가면 uuid 예외가 터진다.
    expect(seen).toHaveLength(0);
  });

  it("제안서 등록 — 브랜드 값이 깨져 있어도 던지지 않는다", async () => {
    const r = await A.createMktProposalAction({ brand_id: BAD, title: "제안" });
    expect(r.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("카드 단계 이동·수정·삭제도 같다", async () => {
    for (const call of [
      () => A.setMktStatusAction(BAD, "sent"),
      () => A.updateMktProjectAction({ id: BAD, title: "x" }),
      () => A.deleteMktProjectAction(BAD),
      () => A.createProposalForProjectAction(BAD),
      () => A.regenerateDirectionAction(BAD),
      () => A.updateMktProposalMetaAction({ id: BAD }),
    ]) {
      const r = await call();
      expect(r.ok).toBe(false);
      expect(r.error, String(r.error)).toBeTruthy();
    }
    expect(seen).toHaveLength(0);
  });

  it("정상 uuid 는 그대로 통과해 조회로 간다(막아 버리면 기능이 죽는다)", async () => {
    const ok = "11111111-2222-3333-4444-555555555555";
    const r = await A.createMktProjectAction({ brand_id: ok, title: "11월 캠페인" });
    // 가짜 DB 는 아무것도 못 찾으므로 '브랜드를 찾을 수 없습니다' 까지 간다.
    expect(r.ok).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].sql).toContain("FROM brands WHERE id=$1");
  });
});

describe("BUG-5 — 잘못 연결된 브랜드를 바꿀 수 있다", () => {
  it("재연결은 제안서와 연결된 파이프라인 프로젝트를 함께 옮긴다", () => {
    const src = readFileSync(new URL("../app/(dash)/mkt/actions.ts", import.meta.url), "utf8");
    expect(src).toContain("UPDATE proposals SET brand_id=$2 WHERE id=$1");
    expect(src).toContain("UPDATE mkt_projects SET brand_id=$2, updated_at=now() WHERE proposal_id=$1");
  });

  it("화면에 '연결 브랜드' 선택이 있고 저장 시 brand_id 를 보낸다", () => {
    expect(screen).toContain("연결 브랜드");
    expect(screen).toMatch(/updateMktProposalMetaAction\(\{[\s\S]{0,300}brand_id: brandId/);
  });

  it("재연결 대상 브랜드 값이 깨져 있으면 조용히 넘어가지 않는다", async () => {
    const r = await A.updateMktProposalMetaAction({
      id: "11111111-2222-3333-4444-555555555555", brand_id: BAD,
    });
    expect(r.ok).toBe(false);
  });
});
