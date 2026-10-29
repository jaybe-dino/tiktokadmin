// 원장 → 시트 동기화 통합. Sheets 는 가짜 시트로, DB 는 가짜로 둔다.
//   실제 시트·실제 Google 호출은 하지 않는다.
//   헤더는 운영 시트에 실제로 쓰여 있는 글자(띄어쓰기 포함)를 그대로 쓴다 —
//   그게 이 파일의 핵심 회귀 검증이다.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 가짜 DB ──────────────────────────────────────────────────
interface RunRow {
  id: string; spreadsheet_id: string; run_date: string;
  status: string; attempts: number; startedAt: number;
}
const db = {
  brands: [] as Record<string, unknown>[],
  admins: [] as { id: string; name: string | null }[],
  schemaReady: true,
  runs: [] as RunRow[],
  claimThrows: false,
  finishThrows: false,
  now: () => Date.now(),
};

vi.mock("../lib/db", () => {
  let seq = 0;
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    if (sql.includes("to_regclass('public.sheet_sync_runs')")) return [{ ok: db.schemaReady }];
    if (sql.includes("INSERT INTO sheet_sync_runs")) {
      if (db.claimThrows) throw new Error("claim 실패(모의 DB 오류)");
      const [sid, date, force, staleMin] = args as [string, string, boolean, number];
      const cur = db.runs.find((r) => r.spreadsheet_id === sid && r.run_date === date);
      if (cur) {
        // CLAIM_SQL 의 WHERE 와 같은 판정:
        //   failed → 재시도, done → force 일 때만, running → 상한을 넘겼을 때만.
        const staleAt = db.now() - staleMin * 60_000;
        const may = cur.status === "failed"
          || (cur.status === "done" && force)
          || (cur.status === "running" && cur.startedAt < staleAt);
        if (!may) return [];
        cur.status = "running"; cur.attempts += 1; cur.startedAt = db.now();
        return [{ id: cur.id, fresh: false }];
      }
      const row: RunRow = {
        id: `run${++seq}`, spreadsheet_id: sid, run_date: date,
        status: "running", attempts: 1, startedAt: db.now(),
      };
      db.runs.push(row);
      return [{ id: row.id, fresh: true }];
    }
    if (sql.includes("SELECT status FROM sheet_sync_runs")) {
      const [sid, date] = args as [string, string];
      const cur = db.runs.find((r) => r.spreadsheet_id === sid && r.run_date === date);
      return cur ? [{ status: cur.status }] : [];
    }
    if (sql.includes("UPDATE sheet_sync_runs")) {
      const failed = sql.includes("'failed'");
      if (db.finishThrows && !failed) throw new Error("기록 갱신 실패(모의 DB 오류)");
      const id = String(args[0]);
      const r = db.runs.find((x) => x.id === id);
      if (r) r.status = failed ? "failed" : "done";
      return [];
    }
    if (sql.includes("FROM admin_users")) return db.admins as unknown as Record<string, unknown>[];
    if (sql.includes('"brandsAll"')) {
      return [{ brandsAll: db.brands.length, ledger: db.brands.length,
        testExcluded: 0, endedInLedger: 0, customersPage: db.brands.length }];
    }
    if (sql.includes("FROM brands b")) return db.brands;
    return [];
  };
  return {
    query: run,
    queryRo: run,
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
const R = await import("../lib/ledger-sheet-rows");

// ── 운영 시트의 실제 헤더(A:X) ───────────────────────────────
//   띄어쓰기까지 시트에 쓰여 있는 그대로다. 여기 손대면 회귀 검증이 사라진다.
const REAL_HEADER = [
  "유입일시 (KST)",        // A
  "업체명",                 // B
  "유입출처",               // C
  "진행단계",               // D
  "커뮤확인",               // E
  "담당자 (원장)",          // F
  "최근메일시각 (KST)",     // G
  "최근메일 제목",          // H
  "메모 (직접입력)",        // I
  "최근업데이트 (KST)",     // J
  "최근접촉 (원문표시)",    // K
  "플랜 / 결제",            // L
  "원장 링크",              // M
  "브랜드 ID",              // N
  "수집시각 (KST)",         // O
  "카테고리",               // P
  "전화번호",               // Q
  "이메일",                 // R
  "브랜드 링크",            // S
  "매출액·구간",            // T
  "매출 기준·확인상태",     // U
  "매출 출처",              // V
  "매출 기준연도",          // W
  "매출 통화",              // X
];
const REAL_LOG_HEADER = [
  "기록시각(KST)", "원장건수", "추가건수", "변경건수",
  "메일확인 업체", "실행상태", "기록 기준", "원본",
];

const col = (name: string) => REAL_HEADER.indexOf(name);
const MEMO_COL = col("메모 (직접입력)");
const ID_COL = col("브랜드 ID");
const NAME_COL = col("업체명");
const CAT_COL = col("카테고리");
const PHONE_COL = col("전화번호");
const STAMP_COL = col("수집시각 (KST)");

// ── 가짜 시트 ────────────────────────────────────────────────
//   A1 표기를 실제로 해석해 셀에 값을 넣는다 — 좌표가 틀리면 여기서 드러난다.
class FakeSheet {
  tabs = new Map<string, { firstRow: number; rows: unknown[][] }>();
  appended: unknown[][] = [];
  logAppends: unknown[][] = [];
  calls = 0;
  failOn: string | null = null;

  constructor(tab: string, header: string[], data: unknown[][], logHeader = REAL_LOG_HEADER) {
    this.tabs.set(tab, { firstRow: S.HEADER_ROW, rows: [header, ...data] });
    this.tabs.set("갱신기록", { firstRow: S.LOG_HEADER_ROW, rows: [logHeader] });
  }
  rowsOf(tab: string): unknown[][] { return this.tabs.get(tab)?.rows ?? []; }

  async getValues(range: string): Promise<unknown[][]> {
    if (this.failOn === "get") throw new Error("읽기 실패(모의)");
    const m = /^'(.+)'!([A-Z]*)(\d*):([A-Z]*)(\d*)$/.exec(range);
    if (!m) throw new Error(`범위 형식 오류: ${range}`);
    const [, tab, c1, r1, c2, r2] = m;
    const t = this.tabs.get(tab);
    if (!t) throw new Error(`없는 탭: ${tab}`);
    const at = (sheetRow: number) => t.rows[sheetRow - t.firstRow];
    const lastRow = t.firstRow + t.rows.length - 1;

    if (!c1 && !c2) {                       // '탭'!5:5 — 행 전체
      const out: unknown[][] = [];
      for (let r = Number(r1); r <= Number(r2 || r1); r += 1) out.push(at(r) ?? []);
      return out;
    }
    const from = colIdx(c1);
    const to = c2 ? colIdx(c2) : from;
    const start = r1 ? Number(r1) : t.firstRow;
    const end = r2 ? Number(r2) : lastRow;
    const out: unknown[][] = [];
    for (let r = start; r <= end; r += 1) {
      const row = at(r);
      if (!row) continue;
      out.push(row.slice(from, to + 1));
    }
    return out;
  }

  async batchUpdate(updates: { range: string; values: unknown[][] }[]): Promise<number> {
    if (this.failOn === "update") throw new Error("쓰기 실패(모의)");
    this.calls += 1;
    let n = 0;
    for (const u of updates) {
      const m = /^'(.+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(u.range);
      if (!m) throw new Error(`범위 형식 오류: ${u.range}`);
      const [, tab, c1, r1] = m;
      const t = this.tabs.get(tab)!;
      const row = t.rows[Number(r1) - t.firstRow];
      if (!row) throw new Error(`없는 행: ${u.range}`);
      const start = colIdx(c1);
      u.values[0].forEach((v, i) => { row[start + i] = v; n += 1; });
    }
    return n;
  }

  async append(range: string, values: unknown[][]): Promise<number> {
    if (this.failOn === "append") throw new Error("덧붙이기 실패(모의)");
    const tab = /^'(.+)'!/.exec(range)?.[1] ?? "";
    if (tab === "갱신기록") {
      if (this.failOn === "log") throw new Error("기록 실패(모의)");
      this.logAppends.push(...values);
      this.tabs.get(tab)!.rows.push(...values);
      return values.length;
    }
    this.appended.push(...values);
    this.tabs.get(tab)!.rows.push(...values.map((v) => [...v]));
    return values.length;
  }
}
function colIdx(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function brand(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id, brand_name: name, contact_name: "담당", phone: "010-1111-2222",
    email: `${id}@example.invalid`, category: "뷰티", brand_url: "https://b.example.invalid",
    state: "lead_new", source: "apply_seminar", plan: null, pay_status: "none",
    owner_id: "staff@example.invalid",
    created_at: "2026-10-01T01:00:00Z", updated_at: "2026-10-20T05:00:00Z",
    msg_opt_out: false, archived: false, hold_kind: null, revenue_estimate: null,
    reported_band: null, reported_source: null, reported_at: null,
    last_out_at: null, last_in_at: null, total_messages: 0,
    last_any_at: null, last_any_subject: null, last_any_source: null, last_any_direction: null,
    ...over,
  };
}
function emptyRow(): unknown[] { return new Array(REAL_HEADER.length).fill(""); }

beforeEach(() => {
  db.brands = []; db.admins = [{ id: "staff@example.invalid", name: "김담당" }];
  db.schemaReady = true; db.runs = [];
  db.claimThrows = false; db.finishThrows = false;
  db.now = () => Date.now();
});

describe("운영 시트의 실제 헤더로 동작한다", () => {
  it("'브랜드 ID'(띄어쓰기 있음) 를 ID 열로 찾는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const row = emptyRow(); row[ID_COL] = "b1"; row[NAME_COL] = "옛 이름";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [row]);

    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok, r.error).toBe(true);
    expect(r.updated).toBe(1);
    expect(r.appended).toBe(0);
    expect(sheet.rowsOf("유입·커뮤현황")[1][NAME_COL]).toBe("브랜드1");
  });

  it("A:X 전체 이름을 하나도 빠뜨리지 않고 찾아낸다", () => {
    const { index, duplicates, missingRequired } = S.resolveHeaders(REAL_HEADER);
    expect(duplicates).toEqual([]);
    expect(missingRequired).toEqual([]);
    // 상태표시·회사매출 두 칸은 운영 시트에 아직 없다 — 없는 열은 건너뛴다.
    const notInSheet = ["상태표시", "회사매출하한", "회사매출상한"];
    const expected = R.MANAGED_HEADERS.filter((h) => !notInSheet.includes(h));
    for (const h of expected) expect(index.has(h), h).toBe(true);
    expect(index.get("브랜드ID")).toBe(ID_COL);
    expect(index.get("담당자")).toBe(col("담당자 (원장)"));
    expect(index.get("최근접촉표시")).toBe(col("최근접촉 (원문표시)"));
    expect(index.get("메모(직접입력)")).toBe(MEMO_COL);
  });

  it("띄어쓰기가 다른 헤더에도 메모 보호가 그대로 걸린다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const row = emptyRow(); row[ID_COL] = "b1"; row[MEMO_COL] = "손으로 적은 메모";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [row]);

    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.rowsOf("유입·커뮤현황")[1][MEMO_COL]).toBe("손으로 적은 메모");
  });

  it("전화번호 원문과 날짜 시리얼이 그대로 들어간다", async () => {
    db.brands = [brand("b1", "브랜드1", { phone: "+82 10-1234-5678" })];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    await S.syncLedgerToSheet({ client: sheet, now: new Date("2026-10-29T00:00:00Z") });
    const row = sheet.appended[0];
    expect(row[PHONE_COL]).toBe("+82 10-1234-5678");
    expect(typeof row[STAMP_COL]).toBe("number");
  });
});

describe("기존 행 갱신 — 브랜드 ID 로 찾는다", () => {
  it("행 순서가 바뀌어도 올바른 행을 찾는다", async () => {
    db.brands = [brand("b1", "브랜드1"), brand("b2", "브랜드2")];
    const r1 = emptyRow(); r1[ID_COL] = "b2";
    const r2 = emptyRow(); r2[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [r1, r2]);

    await S.syncLedgerToSheet({ client: sheet });
    const all = sheet.rowsOf("유입·커뮤현황");
    expect(all[1][NAME_COL]).toBe("브랜드2");   // 첫 데이터 행 = b2
    expect(all[2][NAME_COL]).toBe("브랜드1");
  });

  it("없는 ID 는 새 행으로 덧붙인다", async () => {
    db.brands = [brand("b1", "브랜드1"), brand("b9", "신규")];
    const row = emptyRow(); row[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [row]);

    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.updated).toBe(1);
    expect(r.appended).toBe(1);
    expect(sheet.appended[0][ID_COL]).toBe("b9");
  });

  it("원장에서 사라진 행을 지우지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const keep = emptyRow(); keep[ID_COL] = "gone"; keep[NAME_COL] = "옛 브랜드";
    const row = emptyRow(); row[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [keep, row]);

    await S.syncLedgerToSheet({ client: sheet });
    const all = sheet.rowsOf("유입·커뮤현황");
    expect(all).toHaveLength(3);                  // 헤더 + 2행 그대로
    expect(all[1][NAME_COL]).toBe("옛 브랜드");   // 손대지 않았다
  });
});

describe("사람이 쓴 값을 덮지 않는다", () => {
  it("우리가 모르는 열도 건드리지 않는다", async () => {
    const header = [...REAL_HEADER, "사용자 추가열"];
    db.brands = [brand("b1", "브랜드1")];
    const row = new Array(header.length).fill("");
    row[ID_COL] = "b1"; row[header.length - 1] = "사용자 값";
    const sheet = new FakeSheet("유입·커뮤현황", header, [row]);

    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.rowsOf("유입·커뮤현황")[1][header.length - 1]).toBe("사용자 값");
  });

  it("사람이 채워 둔 칸을 '미기록'으로 덮어쓰지 않는다", async () => {
    // 카테고리를 사람이 채워 뒀고, 원장에는 값이 없는 경우.
    db.brands = [brand("b1", "브랜드1", { category: null })];
    const row = emptyRow(); row[ID_COL] = "b1"; row[CAT_COL] = "뷰티(수동 입력)";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [row]);

    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok, r.error).toBe(true);
    expect(sheet.rowsOf("유입·커뮤현황")[1][CAT_COL]).toBe("뷰티(수동 입력)");
    expect(r.keptExisting).toBeGreaterThan(0);
  });

  it("시트에 이미 '미기록'이라고 적힌 칸은 원장 값으로 채운다", async () => {
    db.brands = [brand("b1", "브랜드1", { category: "패션" })];
    const row = emptyRow(); row[ID_COL] = "b1"; row[CAT_COL] = "미기록";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [row]);

    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.rowsOf("유입·커뮤현황")[1][CAT_COL]).toBe("패션");
  });

  it("새 행을 덧붙일 때도 메모 칸은 비워 둔다", async () => {
    db.brands = [brand("b9", "신규")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.appended[0][MEMO_COL]).toBe("");
  });
});

describe("쓰기 전에 멈출 것은 쓰기 전에 멈춘다", () => {
  it("ID 열이 없으면 아무것도 쓰지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", ["업체명", "메모 (직접입력)"], [["", ""]]);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("브랜드ID");
    expect(sheet.calls).toBe(0);
  });

  it("필수 열이 하나라도 없으면 반쪽 기록을 남기지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const header = REAL_HEADER.filter((h) => h !== "전화번호");
    const sheet = new FakeSheet("유입·커뮤현황", header, []);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("필수 열이 없습니다");
    expect(r.error).toContain("전화번호");
    expect(sheet.calls).toBe(0);
    expect(sheet.appended).toHaveLength(0);
  });

  it("같은 열 이름이 두 번 있으면 멈춘다(어디에 쓸지 정할 수 없다)", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const header = [...REAL_HEADER, "브랜드ID"];       // 띄어쓰기만 다른 중복
    const sheet = new FakeSheet("유입·커뮤현황", header, []);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("같은 열이 두 번");
    expect(sheet.calls).toBe(0);
  });

  it("시트에 같은 브랜드 ID 가 두 행에 있으면 멈춘다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const a = emptyRow(); a[ID_COL] = "b1";
    const b = emptyRow(); b[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [a, b]);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("브랜드 ID");
    expect(sheet.calls).toBe(0);
    expect(sheet.appended).toHaveLength(0);
  });
});

describe("쓴 뒤 다시 읽어 확인한다(readback)", () => {
  it("확인되면 성공으로 표시한다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const row = emptyRow(); row[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [row]);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(true);
    expect(db.runs[0].status).toBe("done");
  });

  it("쓴 값이 확인되지 않으면 성공으로 표시하지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const row = emptyRow(); row[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [row]);
    // 쓰기는 성공한 것처럼 보이지만 실제로는 아무것도 반영되지 않는 시트.
    sheet.batchUpdate = async () => 99;
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("다시 읽어 확인하지 못했습니다");
    expect(db.runs[0].status).toBe("failed");
    expect(sheet.logAppends).toHaveLength(0);
  });
});

describe("하루 한 번 · 겹침 방지", () => {
  it("같은 날 두 번째 실행은 건너뛴다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const now = new Date("2026-10-29T00:00:00Z");

    const a = await S.syncLedgerToSheet({ client: sheet, now });
    expect(a.ok, a.error).toBe(true);
    const b = await S.syncLedgerToSheet({ client: sheet, now });
    expect(b.skipped).toContain("이미");
    expect(sheet.appended).toHaveLength(1);   // 중복 적재 없음
  });

  it("동시에 들어오면 한쪽만 쓴다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const s1 = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const s2 = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const now = new Date("2026-10-29T00:00:00Z");

    const [a, b] = await Promise.all([
      S.syncLedgerToSheet({ client: s1, now }),
      S.syncLedgerToSheet({ client: s2, now }),
    ]);
    const wrote = [s1, s2].filter((s) => s.appended.length > 0);
    expect(wrote).toHaveLength(1);
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
    expect(db.runs).toHaveLength(1);
  });

  it("진행 중인 실행은 force 로도 빼앗지 못한다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    db.runs = [{
      id: "run0", spreadsheet_id: "SHEET1", run_date: "2026-10-29",
      status: "running", attempts: 1, startedAt: Date.now(),
    }];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const r = await S.syncLedgerToSheet({
      client: sheet, now: new Date("2026-10-29T00:00:00Z"), force: true,
    });
    expect(r.skipped).toContain("다른 실행이 진행 중");
    expect(sheet.appended).toHaveLength(0);
    expect(sheet.calls).toBe(0);
  });

  it("상한을 넘겨 멈춰 있는 실행만 회수한다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    db.runs = [{
      id: "run0", spreadsheet_id: "SHEET1", run_date: "2026-10-29",
      status: "running", attempts: 1,
      startedAt: Date.now() - (S.RUNNING_STALE_MINUTES + 1) * 60_000,
    }];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const r = await S.syncLedgerToSheet({ client: sheet, now: new Date("2026-10-29T00:00:00Z") });
    expect(r.ok, r.error).toBe(true);
    expect(sheet.appended).toHaveLength(1);
  });

  it("force 면 끝난 날도 다시 돌린다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const now = new Date("2026-10-29T00:00:00Z");
    await S.syncLedgerToSheet({ client: sheet, now });
    const b = await S.syncLedgerToSheet({ client: sheet, now, force: true });
    expect(b.ok, b.error).toBe(true);
  });

  it("날짜 키는 KST 기준이다", () => {
    // 2026-10-28T15:00Z = KST 10-29 00:00
    expect(S.kstDateKey(new Date("2026-10-28T15:00:00Z"))).toBe("2026-10-29");
    expect(S.kstDateKey(new Date("2026-10-28T14:59:00Z"))).toBe("2026-10-28");
  });

  it("실패한 날은 다시 시도할 수 있다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const now = new Date("2026-10-29T00:00:00Z");
    const seed = emptyRow(); seed[ID_COL] = "b1";
    const bad = new FakeSheet("유입·커뮤현황", REAL_HEADER, [seed]);
    bad.failOn = "update";
    const a = await S.syncLedgerToSheet({ client: bad, now });
    expect(a.ok).toBe(false);
    expect(db.runs[0].status).toBe("failed");

    const seed2 = emptyRow(); seed2[ID_COL] = "b1";
    const good = new FakeSheet("유입·커뮤현황", REAL_HEADER, [seed2]);
    const b = await S.syncLedgerToSheet({ client: good, now });
    expect(b.ok, b.error).toBe(true);
  });

  it("DB 오류를 '이미 끝났다'로 넘기지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    db.claimThrows = true;
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBeUndefined();
    expect(r.error).toContain("DB 오류");
    expect(sheet.calls).toBe(0);
    expect(sheet.appended).toHaveLength(0);
  });
});

describe("미리보기(dryRun)", () => {
  it("아무것도 쓰지 않고 건수만 돌려준다", async () => {
    db.brands = [brand("b1", "브랜드1"), brand("b9", "신규")];
    const row = emptyRow(); row[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [row]);

    const r = await S.syncLedgerToSheet({ client: sheet, dryRun: true });
    expect(r.ok, r.error).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.brands).toBe(2);
    expect(r.updated).toBe(1);
    expect(r.appended).toBe(1);
    expect(sheet.calls).toBe(0);
    expect(sheet.appended).toHaveLength(0);
    expect(sheet.logAppends).toHaveLength(0);
  });

  it("실행 기록을 남기지 않아 그날의 실제 실행을 막지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const now = new Date("2026-10-29T00:00:00Z");
    await S.syncLedgerToSheet({ client: sheet, now, dryRun: true });
    expect(db.runs).toHaveLength(0);
    const real = await S.syncLedgerToSheet({ client: sheet, now });
    expect(real.ok, real.error).toBe(true);
  });

  it("열별 채움 현황을 건수로만 담는다", async () => {
    db.brands = [brand("b1", "브랜드1", { category: null })];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const r = await S.syncLedgerToSheet({ client: sheet, dryRun: true });
    expect(r.coverage?.["카테고리"]).toEqual({ filled: 0, unknown: 1 });
    expect(r.coverage?.["업체명"]).toEqual({ filled: 1, unknown: 0 });
    // 값·연락처는 담지 않는다 — 숫자 두 개뿐이다.
    for (const v of Object.values(r.coverage ?? {})) {
      expect(Object.keys(v).sort()).toEqual(["filled", "unknown"]);
    }
  });
});

describe("실패 처리", () => {
  it("마이그레이션이 없으면 쓰지 않는다", async () => {
    db.schemaReady = false;
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("0115");
    expect(sheet.calls).toBe(0);
  });

  it("인증이 없으면 시트에 접근조차 하지 않는다(fail closed)", async () => {
    db.brands = [brand("b1", "브랜드1")];
    // client 를 주지 않으면 실제 인증 경로 → 설정이 비어 있으므로 막힌다.
    const r = await S.syncLedgerToSheet({});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("설정이 없습니다");
    expect(r.error).toContain("GOOGLE_SA_KEY_JSON");
  });

  it("읽기 실패는 실패로 닫고 쓰지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    sheet.failOn = "get";
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(sheet.calls).toBe(0);
    expect(db.runs[0].status).toBe("failed");
  });

  it("실패하면 갱신기록을 남기지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const seed = emptyRow(); seed[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [seed]);
    sheet.failOn = "update";
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(sheet.logAppends).toHaveLength(0);
  });

  it("실행 기록 갱신 실패를 삼키지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    db.finishThrows = true;
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(true);                    // 시트에는 들어갔다
    expect(r.warnings?.join(" ")).toContain("done");
  });

  it("갱신기록 쓰기 실패도 경고로 올린다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    sheet.failOn = "log";
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(true);
    expect(r.warnings?.join(" ")).toContain("갱신기록");
  });
});

describe("갱신기록 탭", () => {
  it("실제 헤더 순서에 맞춰 적는다", async () => {
    db.brands = [
      brand("b1", "브랜드1", {
        last_any_at: "2026-10-20T01:00:00Z", last_any_direction: "in",
        last_any_source: "gmail", last_any_subject: "문의",
      }),
      brand("b2", "브랜드2"),
    ];
    const seed = emptyRow(); seed[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [seed]);
    const now = new Date("2026-10-29T00:00:00Z");

    const r = await S.syncLedgerToSheet({ client: sheet, now });
    expect(r.ok, r.error).toBe(true);
    const line = sheet.logAppends[0];
    expect(line).toHaveLength(REAL_LOG_HEADER.length);
    expect(line[0]).toBe(R.dateCell(now.toISOString()));   // A 기록시각(KST)
    expect(line[1]).toBe(2);                                // B 원장건수
    expect(line[2]).toBe(1);                                // C 추가건수(b2)
    expect(line[3]).toBe(1);                                // D 변경건수(b1)
    expect(line[4]).toBe(1);                                // E 메일확인 업체
    expect(line[5]).toBe("성공");                            // F 실행상태
    expect(String(line[6])).toContain("2026-10-29");         // G 기록 기준
    expect(String(line[7])).toContain("원장");               // H 원본
  });

  it("헤더 모양이 다르면 쓰지 않고 알린다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, [],
      ["기록시각(KST)", "추가건수", "원장건수", "변경건수", "메일확인 업체", "실행상태", "기록 기준", "원본"]);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(true);
    expect(sheet.logAppends).toHaveLength(0);
    expect(r.warnings?.join(" ")).toContain("헤더가 예상과 다릅니다");
  });
});

describe("원장 전체", () => {
  it("수신거부·보류도 싣는다(상태표시 열이 있으면 표시한다)", async () => {
    db.brands = [brand("b1", "거부브랜드", { msg_opt_out: true, hold_kind: "장기보류" })];
    const header = [...REAL_HEADER, "상태표시"];
    const sheet = new FakeSheet("유입·커뮤현황", header, []);
    await S.syncLedgerToSheet({ client: sheet });
    const row = sheet.appended[0];
    expect(row[header.indexOf("상태표시")]).toContain("수신거부");
    expect(row[NAME_COL]).toBe("거부브랜드");
  });

  it("회사매출 열을 추가하면 회사 범위 추정만 숫자로 채운다", async () => {
    const header = [...REAL_HEADER, "회사매출 하한", "회사매출 상한"];
    const est = (scope: string) => ({
      status: "estimated", lower: 5_000_000_000, upper: 7_000_000_000,
      currency: "KRW", year: 2025, scope, entity: "TEST 주식회사",
      confidence: "high", estimated_at: "2026-10-01T00:00:00+09:00",
      rationale: "공시", sources: [{ title: "공시", url: "https://x.example.invalid/a" }],
    });
    db.brands = [
      brand("b1", "회사추정", { revenue_estimate: est("company_separate") as never }),
      brand("b2", "브랜드추정", { revenue_estimate: est("brand") as never }),
      brand("b3", "자기신고", { reported_band: "b1_10", reported_at: "2026-09-10T00:00:00Z" }),
    ];
    const sheet = new FakeSheet("유입·커뮤현황", header, []);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok, r.error).toBe(true);

    const lo = header.indexOf("회사매출 하한");
    const hi = header.indexOf("회사매출 상한");
    expect(sheet.appended[0][lo]).toBe(5_000_000_000);
    expect(sheet.appended[0][hi]).toBe(7_000_000_000);
    // 브랜드 단위 추정과 브랜드 자기신고는 회사 매출로 승격되지 않는다.
    expect(sheet.appended[1][lo]).toBe(R.UNCONFIRMED);
    expect(sheet.appended[2][lo]).toBe(R.UNCONFIRMED);
  });

  it("상태표시 열이 없는 운영 시트에서도 행은 그대로 실린다", async () => {
    db.brands = [brand("b1", "거부브랜드", { msg_opt_out: true })];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok, r.error).toBe(true);
    expect(sheet.appended[0][NAME_COL]).toBe("거부브랜드");
  });

  it("담당자 id 를 이름으로 바꿔 적는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.appended[0][col("담당자 (원장)")]).toBe("김담당");
  });

  it("담는 범위를 /customers 와 비교할 수 있게 숫자로 남긴다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", REAL_HEADER, []);
    const r = await S.syncLedgerToSheet({ client: sheet, dryRun: true });
    expect(r.scope).toMatchObject({ ledger: 1, customersPage: 1 });
  });
});

describe("쓰기 방식", () => {
  it("RAW 로만 쓴다 — 수식 해석을 켜지 않는다", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../lib/google-sheets.ts", import.meta.url), "utf8"));
    expect(src).toContain('valueInputOption: "RAW"');
    expect(src).toContain("valueInputOption=RAW");
    expect(src).not.toContain("USER_ENTERED");
  });

  it("저장된 값 그대로 읽는다(서식 글자가 아니라 숫자로 비교해야 한다)", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../lib/google-sheets.ts", import.meta.url), "utf8"));
    expect(src).toContain("UNFORMATTED_VALUE");
  });
});

describe("좌표 계산", () => {
  it("열 번호 → 글자", () => {
    expect(S.colLetter(0)).toBe("A");
    expect(S.colLetter(25)).toBe("Z");
    expect(S.colLetter(26)).toBe("AA");
    expect(S.colLetter(27)).toBe("AB");
    expect(S.colLetter(51)).toBe("AZ");
    expect(S.colLetter(52)).toBe("BA");
  });

  it("붙어 있는 칸은 한 범위로 묶는다(요청 수를 줄인다)", () => {
    const index = new Map([["A열", 0], ["B열", 1], ["D열", 3]]);
    const out = S.rangesForRow("탭", 7, { "A열": "a", "B열": "b", "D열": "d" }, index, ["A열", "B열", "D열"]);
    expect(out).toHaveLength(2);
    expect(out[0].range).toBe("'탭'!A7:B7");
    expect(out[1].range).toBe("'탭'!D7:D7");
  });

  it("지켜야 하는 칸을 빼고 묶는다", () => {
    const index = new Map([["A열", 0], ["B열", 1], ["C열", 2]]);
    const out = S.rangesForRow("탭", 7,
      { "A열": "a", "B열": R.UNKNOWN, "C열": "c" }, index, ["A열", "B열", "C열"],
      ["", "사람이 적은 값", ""]);
    expect(out).toHaveLength(2);
    expect(out[0].range).toBe("'탭'!A7:A7");
    expect(out[1].range).toBe("'탭'!C7:C7");
  });
});

describe("요약 문구", () => {
  it("연락처·매출을 담지 않는다", () => {
    const s = S.summarize({ ok: true, brands: 10, updated: 9, appended: 1, keptExisting: 3 });
    expect(s).toContain("원장 10");
    expect(s).toContain("보존 3");
    expect(s).not.toMatch(/@|010-|\+82/);
  });

  it("실패는 실패라고 말한다", () => {
    expect(S.summarize({ ok: false, error: "권한 없음" })).toContain("실패");
  });
});
