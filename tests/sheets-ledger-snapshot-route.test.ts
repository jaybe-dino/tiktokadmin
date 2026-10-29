// 원장 스냅샷 조회 경로 — 권한 게이트와 "무엇을 돌려주지 않는가" 를 고정한다.
//   Google 권한 승인 전 검증용 경로라, 여기서 새는 값이 있으면 그게 사고다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: null as { id: string; role: string } | null };

// vitest 에는 "@" 별칭이 없다. 라우트가 쓰는 "@/..." 를 모두 여기서 잇는다.
//   ledger-sheet-rows 는 실제 구현을 그대로 쓴다 — 열 목록을 진짜와 비교해야 한다.
vi.mock("@/lib/ledger-sheet-rows", async () => await import("../lib/ledger-sheet-rows"));
vi.mock("@/lib/auth", () => ({ currentUser: async () => session.user }));
vi.mock("@/lib/google-sheets", () => ({
  sheetsAuthState: () => ({
    ready: false, reason: "설정이 없습니다", hasServiceAccount: true,
    hasSpreadsheetId: true, mode: "self",
    clientEmail: "sheets-sync@test-project.iam.gserviceaccount.invalid",
  }),
}));
vi.mock("@/lib/ledger-sheet-sync", () => ({
  readLedger: async () => [{
    id: "11111111-1111-1111-1111-111111111111",
    brand_name: "TEST 브랜드", contact_name: "TEST 담당",
    phone: "010-1111-2222", email: "lead@example.invalid",
    category: "뷰티", brand_url: "https://b.example.invalid",
    state: "lead_new", source: "direct", plan: null, pay_status: "none",
    owner_label: "김담당", created_at: "2026-10-01T01:00:00Z",
    updated_at: "2026-10-20T05:00:00Z", comms: {},
  }],
  ledgerScope: async () => ({
    brandsAll: 1, ledger: 1, testExcluded: 0, endedInLedger: 0, customersPage: 1,
  }),
  latestRunAudit: async () => ({
    available: true, status: "failed", runDate: "2026-10-30", attempts: 1,
    brands: 0, updatedRows: 0, appendedRows: 0,
    startedAt: "2026-10-30T00:00:00Z", finishedAt: "2026-10-30T00:00:03Z",
    error: "시트 접근이 거부되었습니다(HTTP 403).",
  }),
  rowOptions: (collectedAt: string) => ({
    adminUrl: "https://admin.example.invalid", collectedAt,
    stateLabel: (s: string | null) => s ?? "",
    sourceLabel: (s: string | null) => s ?? "",
    planLabel: () => "",
  }),
}));

const route = await import("../app/api/admin/sheets-ledger/snapshot/route");
const R = await import("../lib/ledger-sheet-rows");

beforeEach(() => { session.user = null; });

describe("권한", () => {
  it("로그인하지 않으면 401", async () => {
    const res = await route.GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("exec 가 아니면 403 — 다른 역할은 모두 막는다", async () => {
    for (const role of ["intake", "sales", "onboard", "ads", "settle", "lead"]) {
      session.user = { id: "u@example.invalid", role };
      const res = await route.GET();
      expect(res.status, role).toBe(403);
      expect((await res.json()).error, role).toBe("forbidden");
    }
  });

  it("exec 만 통과한다", async () => {
    session.user = { id: "boss@example.invalid", role: "exec" };
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("캐시에 남지 않는다", async () => {
    session.user = { id: "boss@example.invalid", role: "exec" };
    const res = await route.GET();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("응답 내용", () => {
  beforeEach(() => { session.user = { id: "boss@example.invalid", role: "exec" }; });

  it("건수와 시트 열만 담는다", async () => {
    const body = await (await route.GET()).json();
    expect(body.count).toBe(1);
    expect(body.rows).toHaveLength(1);
    expect(body.fields).toEqual([...R.MANAGED_HEADERS]);
    // 행의 키는 승인된 시트 열 이름뿐이다.
    for (const k of Object.keys(body.rows[0])) {
      expect([...R.MANAGED_HEADERS], k).toContain(k);
    }
  });

  it("은행·서류·비밀번호·토큰은 어떤 키로도 나오지 않는다", async () => {
    const text = JSON.stringify(await (await route.GET()).json());
    for (const bad of ["bank", "account_no", "계좌", "password", "비밀번호",
      "token", "secret", "private_key", "doc_url", "사업자등록"]) {
      expect(text.includes(bad), bad).toBe(false);
    }
  });

  it("서비스계정 이메일만 공개하고 비밀키·토큰·위임 ID 는 담지 않는다", async () => {
    const body = await (await route.GET()).json();
    expect(body.meta.serviceAccountEmail)
      .toBe("sheets-sync@test-project.iam.gserviceaccount.invalid");
    expect(Object.keys(body.meta).sort()).toEqual([
      "authMode", "runtimeHasServiceAccountKey", "runtimeHasSpreadsheetId",
      "serviceAccountEmail", "sheetWriteReady",
    ]);
  });

  it("런타임 설정 여부를 '운영에 없음' 으로 단정하지 않는다", async () => {
    const body = await (await route.GET()).json();
    // 이름 자체가 런타임 기준임을 말한다 — 운영 env 유무를 주장하지 않는다.
    expect(body.meta).toHaveProperty("runtimeHasServiceAccountKey");
    expect(body.meta).not.toHaveProperty("productionHasServiceAccountKey");
  });

  it("최신 실행 감사 상태 한 건을 함께 준다", async () => {
    const body = await (await route.GET()).json();
    expect(body.latestRun).toMatchObject({
      available: true, status: "failed", runDate: "2026-10-30",
      attempts: 1, brands: 0, updatedRows: 0, appendedRows: 0,
    });
    expect(body.latestRun).toHaveProperty("startedAt");
    expect(body.latestRun).toHaveProperty("finishedAt");
    expect(body.latestRun).toHaveProperty("error");
  });

  it("담는 범위 숫자를 함께 준다(/customers 와 비교용)", async () => {
    const body = await (await route.GET()).json();
    expect(body.scope).toMatchObject({ ledger: 1, customersPage: 1 });
  });
});
