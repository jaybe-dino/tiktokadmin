// 운영 첫 실행 진단 — 두 경계만 고정한다.
//   ① 최신 실행 감사 상태: 이 시트 한정 · 표 없음/조회 실패는 unavailable
//   ② Google 403 분류: 허용된 사유 코드만 읽고, 못 읽으면 ACL 로 단정하지 않는다
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  schemaReady: true,
  rows: [] as Record<string, unknown>[],
  auditThrows: false,
  lastArgs: null as unknown[] | null,
  lastSql: "",
};

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    if (sql.includes("to_regclass('public.sheet_sync_runs')")) return [{ ok: db.schemaReady }];
    if (sql.includes("FROM sheet_sync_runs")) {
      db.lastSql = sql; db.lastArgs = args;
      if (db.auditThrows) throw new Error("권한 없음(모의 DB 오류)");
      return db.rows;
    }
    return [];
  };
  return {
    query: run, queryRo: run,
    queryOne: async (s: string, a?: unknown[]) => (await run(s, a))[0] ?? null,
  };
});

vi.mock("../lib/env", () => ({
  env: {
    adminUrl: "https://admin.example.invalid",
    sheets: {
      saKeyJson: "", subject: "", ledgerSpreadsheetId: "SHEET1",
      ledgerTab: "유입·커뮤현황", logTab: "갱신기록",
    },
  },
}));

const S = await import("../lib/ledger-sheet-sync");
const G = await import("../lib/google-sheets");

const RUN = {
  status: "failed", run_date: "2026-10-30", attempts: 1,
  brands: 0, updated_rows: 0, appended_rows: 0,
  started_at: "2026-10-30T00:00:00Z", finished_at: "2026-10-30T00:00:03Z",
  error: "시트 접근이 거부되었습니다(HTTP 403).",
};

beforeEach(() => {
  db.schemaReady = true; db.rows = []; db.auditThrows = false;
  db.lastArgs = null; db.lastSql = "";
});

describe("최신 실행 감사 상태", () => {
  it("요청한 아홉 가지를 그대로 돌려준다", async () => {
    db.rows = [RUN];
    const a = await S.latestRunAudit();
    expect(a).toEqual({
      available: true,
      status: "failed", runDate: "2026-10-30", attempts: 1,
      brands: 0, updatedRows: 0, appendedRows: 0,
      startedAt: "2026-10-30T00:00:00Z", finishedAt: "2026-10-30T00:00:03Z",
      error: "시트 접근이 거부되었습니다(HTTP 403).",
    });
  });

  it("이 시트 하나로 한정해 한 건만 읽는다", async () => {
    db.rows = [RUN];
    await S.latestRunAudit();
    expect(db.lastArgs).toEqual(["SHEET1"]);
    expect(db.lastSql).toContain("spreadsheet_id = $1");
    expect(db.lastSql).toContain("LIMIT 1");
    // 읽기 전용 고정 SELECT — 쓰기 문장이 섞이지 않는다.
    expect(db.lastSql.trimStart().startsWith("SELECT")).toBe(true);
    expect(db.lastSql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\s/i);
  });

  it("표가 없으면 unavailable 로 명시한다(없는 걸 성공으로 보지 않는다)", async () => {
    db.schemaReady = false;
    const a = await S.latestRunAudit();
    expect(a.available).toBe(false);
    expect(a).toHaveProperty("unavailable");
    expect((a as { unavailable: string }).unavailable).toContain("0115");
  });

  it("조회가 실패하면 unavailable 로 명시하고 사유 원문을 싣지 않는다", async () => {
    db.auditThrows = true;
    const a = await S.latestRunAudit();
    expect(a.available).toBe(false);
    const reason = (a as { unavailable: string }).unavailable;
    expect(reason).toBe("실행 기록 조회 실패(DB)");
    expect(reason).not.toContain("권한 없음");     // 모의 예외 문구가 새지 않는다
  });

  it("기록이 아예 없으면 '선점 전 중단' 으로 알려 준다", async () => {
    db.rows = [];
    const a = await S.latestRunAudit();
    expect(a.available).toBe(false);
    expect((a as { unavailable: string }).unavailable).toContain("선점 전 중단");
  });

  it("연락처·매출·키·토큰을 담을 필드가 없다", async () => {
    db.rows = [{ ...RUN, phone: "010-1111-2222", token: "secret-xyz" }];
    const a = await S.latestRunAudit();
    const text = JSON.stringify(a);
    expect(text).not.toContain("010-1111-2222");
    expect(text).not.toContain("secret-xyz");
    expect(Object.keys(a).sort()).toEqual([
      "appendedRows", "attempts", "available", "brands", "error",
      "finishedAt", "runDate", "startedAt", "status", "updatedRows",
    ]);
  });
});

describe("Google 403 분류", () => {
  const body = (reason: string) => ({
    error: {
      code: 403, status: "PERMISSION_DENIED",
      message: "Google Sheets API has not been used in project 1234567890 before",
      details: [{
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason,
        domain: "googleapis.com",
        metadata: { service: "sheets.googleapis.com", consumer: "projects/1234567890" },
      }],
    },
  });

  it("허용된 사유 코드만 읽는다", () => {
    expect(G.denyReason(body("SERVICE_DISABLED"))).toBe("SERVICE_DISABLED");
    expect(G.denyReason(body("ACCESS_TOKEN_SCOPE_INSUFFICIENT")))
      .toBe("ACCESS_TOKEN_SCOPE_INSUFFICIENT");
  });

  it("허용 목록에 없는 코드는 읽지 않는다", () => {
    expect(G.denyReason(body("SOMETHING_NEW"))).toBe(null);
    expect(G.denyReason(body("__proto__"))).toBe(null);
    expect(G.denyReason(body("constructor"))).toBe(null);
  });

  it("본문이 비거나 모양이 다르면 null 이다", () => {
    expect(G.denyReason(null)).toBe(null);
    expect(G.denyReason({})).toBe(null);
    expect(G.denyReason({ error: { details: "nope" } })).toBe(null);
    expect(G.denyReason({ error: { details: [{ nope: 1 }] } })).toBe(null);
  });

  it("서비스 미활성 · API 권한 · 파일 공유를 구분해 말한다", () => {
    expect(G.forbiddenMessage("SERVICE_DISABLED")).toContain("서비스 미활성");
    expect(G.forbiddenMessage("ACCESS_TOKEN_SCOPE_INSUFFICIENT")).toContain("API 권한");
    expect(G.forbiddenMessage("API_KEY_SERVICE_BLOCKED")).toContain("API 권한");
  });

  it("사유를 못 읽으면 ACL 문제로 단정하지 않는다", () => {
    const m = G.forbiddenMessage(null);
    expect(m).toContain("단정할 수 없습니다");
    expect(m).toContain("서비스 미활성");
    expect(m).toContain("API 권한");
    expect(m).toContain("파일 공유");
  });

  it("원문 message·metadata 값을 응답에 옮기지 않는다", () => {
    const m = G.forbiddenMessage(G.denyReason(body("SERVICE_DISABLED")));
    expect(m).not.toContain("1234567890");                 // consumer
    expect(m).not.toContain("sheets.googleapis.com");      // service
    expect(m).not.toContain("has not been used in project"); // message 원문
    // 사유 코드 자체는 고정 열거값이므로 남겨도 된다.
    expect(m).toContain("SERVICE_DISABLED");
  });
});
