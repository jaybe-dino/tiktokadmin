// 원장 → 시트 동기화 통합. Sheets 는 가짜 시트로, DB 는 가짜로 둔다.
//   실제 시트·실제 Google 호출은 하지 않는다.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 가짜 DB ──────────────────────────────────────────────────
const db = {
  brands: [] as Record<string, unknown>[],
  admins: [] as { id: string; name: string | null }[],
  schemaReady: true,
  runs: [] as { id: string; spreadsheet_id: string; run_date: string; status: string; attempts: number }[],
  claimFails: false,
};

vi.mock("../lib/db", () => {
  let seq = 0;
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    if (sql.includes("to_regclass('public.sheet_sync_runs')")) return [{ ok: db.schemaReady }];
    if (sql.includes("INSERT INTO sheet_sync_runs")) {
      if (db.claimFails) throw new Error("claim conflict");
      const [sid, date, force] = args as [string, string, boolean];
      const cur = db.runs.find((r) => r.spreadsheet_id === sid && r.run_date === date);
      if (cur) {
        // ON CONFLICT ... WHERE status <> 'done' OR $3 — 조건에 안 맞으면 행이 없다.
        if (cur.status === "done" && !force) return [];
        cur.status = "running"; cur.attempts += 1;
        return [{ id: cur.id, fresh: false }];
      }
      const row = { id: `run${++seq}`, spreadsheet_id: sid, run_date: date, status: "running", attempts: 1 };
      db.runs.push(row);
      return [{ id: row.id, fresh: true }];
    }
    if (sql.includes("UPDATE sheet_sync_runs")) {
      const id = String(args[0]);
      const r = db.runs.find((x) => x.id === id);
      if (r) r.status = sql.includes("'failed'") ? "failed" : "done";
      return [];
    }
    if (sql.includes("FROM admin_users")) return db.admins as unknown as Record<string, unknown>[];
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

// ── 가짜 시트 ────────────────────────────────────────────────
//   A1 표기를 실제로 해석해 셀에 값을 넣는다 — 좌표가 틀리면 여기서 드러난다.
class FakeSheet {
  grid = new Map<string, Map<number, string>>();   // tab -> row -> cells(배열을 문자열로)
  rows = new Map<string, string[][]>();
  appended: unknown[][] = [];
  logAppends: unknown[][] = [];
  calls = 0;
  failOn: string | null = null;

  constructor(tab: string, header: string[], data: string[][]) {
    this.rows.set(tab, [header, ...data]);
  }
  private cells(tab: string): string[][] { return this.rows.get(tab) ?? []; }

  async getValues(range: string): Promise<string[][]> {
    if (this.failOn === "get") throw new Error("읽기 실패(모의)");
    const m = /^'(.+)'!([A-Z]+)?(\d+)?:([A-Z]+)?(\d*)$/.exec(range);
    const tab = m?.[1] ?? "";
    const all = this.cells(tab);
    // 헤더 한 줄 요청
    if (/^'.+'!5:5$/.test(range)) return [all[0] ?? []];
    // 한 열 요청(ID 열)
    const col = m?.[2];
    if (col) {
      const ci = colIdx(col);
      return all.slice(1).map((r) => [r[ci] ?? ""]);
    }
    return all;
  }
  async batchUpdate(updates: { range: string; values: unknown[][] }[]): Promise<number> {
    if (this.failOn === "update") throw new Error("쓰기 실패(모의)");
    this.calls += 1;
    let n = 0;
    for (const u of updates) {
      const m = /^'(.+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(u.range);
      if (!m) throw new Error(`범위 형식 오류: ${u.range}`);
      const [, tab, c1, r1] = m;
      const all = this.cells(tab);
      const rowIdx = Number(r1) - 5;     // 헤더가 5행 → 배열 0
      const start = colIdx(c1);
      const row = all[rowIdx];
      if (!row) throw new Error(`없는 행: ${u.range}`);
      u.values[0].forEach((v, i) => { row[start + i] = v === undefined ? "" : String(v); n += 1; });
    }
    return n;
  }
  async append(range: string, values: unknown[][]): Promise<number> {
    if (range.includes("갱신기록")) { this.logAppends.push(...values); return values.length; }
    this.appended.push(...values);
    const tab = /^'(.+)'!/.exec(range)?.[1] ?? "";
    const all = this.cells(tab);
    for (const v of values) all.push(v.map((x) => (x === undefined ? "" : String(x))));
    return values.length;
  }
}
function colIdx(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const HEADER = [
  "유입일시(KST)", "업체명", "유입출처", "진행단계", "커뮤확인", "담당자",
  "최근메일시각(KST)", "최근메일제목", "메모(직접입력)", "최근업데이트(KST)",
  "최근접촉표시", "플랜/결제", "원장링크", "브랜드ID", "수집시각(KST)",
  "카테고리", "전화번호", "이메일", "브랜드링크",
  "매출액·구간", "매출기준·확인상태", "매출출처", "매출기준연도", "매출통화", "상태표시",
];
const MEMO_COL = HEADER.indexOf("메모(직접입력)");
const ID_COL = HEADER.indexOf("브랜드ID");

function brand(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id, brand_name: name, contact_name: "담당", phone: "01011112222",
    email: `${id}@example.invalid`, category: "뷰티", brand_url: "https://b.example.invalid",
    state: "lead_new", source: "apply_seminar", plan: null, pay_status: "none",
    owner_id: "staff@example.invalid",
    created_at: "2026-10-01T01:00:00Z", updated_at: "2026-10-20T05:00:00Z",
    msg_opt_out: false, archived: false, hold_kind: null, revenue_estimate: null,
    reported_band: null, reported_source: null, reported_at: null,
    last_out_at: null, last_in_at: null, last_manual_at: null,
    total_messages: 0, last_out_subject: null, last_in_subject: null,
    ...over,
  };
}
function emptyRow(): string[] { return new Array(HEADER.length).fill(""); }

beforeEach(() => {
  db.brands = []; db.admins = [{ id: "staff@example.invalid", name: "김담당" }];
  db.schemaReady = true; db.runs = []; db.claimFails = false;
});

describe("기존 행 갱신 — 브랜드 ID 로 찾는다", () => {
  it("ID 가 있으면 그 행을 갱신하고 새 행을 만들지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const row = emptyRow(); row[ID_COL] = "b1"; row[1] = "옛 이름";
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, [row]);

    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(true);
    expect(r.updated).toBe(1);
    expect(r.appended).toBe(0);
    expect(sheet.rows.get("유입·커뮤현황")![1][1]).toBe("브랜드1");
  });

  it("행 순서가 바뀌어도 올바른 행을 찾는다", async () => {
    db.brands = [brand("b1", "브랜드1"), brand("b2", "브랜드2")];
    const r1 = emptyRow(); r1[ID_COL] = "b2";
    const r2 = emptyRow(); r2[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, [r1, r2]);

    await S.syncLedgerToSheet({ client: sheet });
    const all = sheet.rows.get("유입·커뮤현황")!;
    expect(all[1][1]).toBe("브랜드2");   // 첫 데이터 행 = b2
    expect(all[2][1]).toBe("브랜드1");
  });

  it("없는 ID 는 새 행으로 덧붙인다", async () => {
    db.brands = [brand("b1", "브랜드1"), brand("b9", "신규")];
    const row = emptyRow(); row[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, [row]);

    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.updated).toBe(1);
    expect(r.appended).toBe(1);
    expect(sheet.appended[0][ID_COL]).toBe("b9");
  });

  it("원장에서 사라진 행을 지우지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const keep = emptyRow(); keep[ID_COL] = "gone"; keep[1] = "옛 브랜드";
    const row = emptyRow(); row[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, [keep, row]);

    await S.syncLedgerToSheet({ client: sheet });
    const all = sheet.rows.get("유입·커뮤현황")!;
    expect(all).toHaveLength(3);          // 헤더 + 2행 그대로
    expect(all[1][1]).toBe("옛 브랜드");  // 손대지 않았다
  });
});

describe("사람이 쓴 값을 덮지 않는다", () => {
  it("메모 칸은 갱신 뒤에도 그대로다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const row = emptyRow(); row[ID_COL] = "b1"; row[MEMO_COL] = "손으로 적은 메모";
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, [row]);

    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.rows.get("유입·커뮤현황")![1][MEMO_COL]).toBe("손으로 적은 메모");
  });

  it("우리가 모르는 열도 건드리지 않는다", async () => {
    const header = [...HEADER, "사용자 추가열"];
    db.brands = [brand("b1", "브랜드1")];
    const row = new Array(header.length).fill("");
    row[ID_COL] = "b1"; row[header.length - 1] = "사용자 값";
    const sheet = new FakeSheet("유입·커뮤현황", header, [row]);

    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.rows.get("유입·커뮤현황")![1][header.length - 1]).toBe("사용자 값");
  });

  it("새 행을 덧붙일 때도 메모 칸은 비워 둔다", async () => {
    db.brands = [brand("b9", "신규")];
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, []);
    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.appended[0][MEMO_COL]).toBe("");
  });
});

describe("열 위치에 의존하지 않는다", () => {
  it("헤더 순서를 바꿔도 이름으로 찾아 쓴다", async () => {
    const shuffled = ["브랜드ID", "메모(직접입력)", "업체명", "전화번호", "카테고리"];
    db.brands = [brand("b1", "브랜드1")];
    const row = new Array(shuffled.length).fill("");
    row[0] = "b1"; row[1] = "메모 유지";
    const sheet = new FakeSheet("유입·커뮤현황", shuffled, [row]);

    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(true);
    const got = sheet.rows.get("유입·커뮤현황")![1];
    expect(got[2]).toBe("브랜드1");
    expect(got[3]).toBe("01011112222");
    expect(got[1]).toBe("메모 유지");
  });

  it("ID 열이 없으면 아무것도 쓰지 않고 멈춘다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", ["업체명", "메모(직접입력)"], [["", ""]]);
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("브랜드ID");
    expect(sheet.calls).toBe(0);
  });
});

describe("하루 한 번 · 겹침 방지", () => {
  it("같은 날 두 번째 실행은 건너뛴다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, []);
    const now = new Date("2026-10-29T00:00:00Z");

    const a = await S.syncLedgerToSheet({ client: sheet, now });
    expect(a.ok).toBe(true);
    const b = await S.syncLedgerToSheet({ client: sheet, now });
    expect(b.skipped).toContain("이미");
    expect(sheet.appended).toHaveLength(1);   // 중복 적재 없음
  });

  it("force 면 같은 날도 다시 돌린다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, []);
    const now = new Date("2026-10-29T00:00:00Z");
    await S.syncLedgerToSheet({ client: sheet, now });
    const b = await S.syncLedgerToSheet({ client: sheet, now, force: true });
    expect(b.ok).toBe(true);
  });

  it("날짜 키는 KST 기준이다", () => {
    // 2026-10-28T15:00Z = KST 10-29 00:00
    expect(S.kstDateKey(new Date("2026-10-28T15:00:00Z"))).toBe("2026-10-29");
    expect(S.kstDateKey(new Date("2026-10-28T14:59:00Z"))).toBe("2026-10-28");
  });

  it("실패한 날은 다시 시도할 수 있다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const now = new Date("2026-10-29T00:00:00Z");
    // 갱신 경로를 타야 쓰기 실패가 난다 — 기존 행을 깔아 둔다.
    const seed = emptyRow(); seed[ID_COL] = "b1";
    const bad = new FakeSheet("유입·커뮤현황", HEADER, [seed]);
    bad.failOn = "update";
    const a = await S.syncLedgerToSheet({ client: bad, now });
    expect(a.ok).toBe(false);
    expect(db.runs[0].status).toBe("failed");

    const seed2 = emptyRow(); seed2[ID_COL] = "b1";
    const good = new FakeSheet("유입·커뮤현황", HEADER, [seed2]);
    const b = await S.syncLedgerToSheet({ client: good, now });
    expect(b.ok).toBe(true);
  });
});

describe("실패 처리", () => {
  it("마이그레이션이 없으면 쓰지 않는다", async () => {
    db.schemaReady = false;
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, []);
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
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, []);
    sheet.failOn = "get";
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(sheet.calls).toBe(0);
    expect(db.runs[0].status).toBe("failed");
  });

  it("실패하면 갱신기록을 남기지 않는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const seed = emptyRow(); seed[ID_COL] = "b1";
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, [seed]);
    sheet.failOn = "update";
    const r = await S.syncLedgerToSheet({ client: sheet });
    expect(r.ok).toBe(false);
    expect(sheet.logAppends).toHaveLength(0);
  });

  it("성공하면 갱신기록을 남긴다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, []);
    await S.syncLedgerToSheet({ client: sheet });
    expect(sheet.logAppends).toHaveLength(1);
    expect(sheet.logAppends[0]).toContain("done");
  });
});

describe("원장 전체", () => {
  it("수신거부·보류도 싣되 상태를 표시한다", async () => {
    db.brands = [brand("b1", "거부브랜드", { msg_opt_out: true, hold_kind: "장기보류" })];
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, []);
    await S.syncLedgerToSheet({ client: sheet });
    const row = sheet.appended[0] as string[];
    expect(row[HEADER.indexOf("상태표시")]).toContain("수신거부");
    expect(row[HEADER.indexOf("업체명")]).toBe("거부브랜드");
  });

  it("담당자 id 를 이름으로 바꿔 적는다", async () => {
    db.brands = [brand("b1", "브랜드1")];
    const sheet = new FakeSheet("유입·커뮤현황", HEADER, []);
    await S.syncLedgerToSheet({ client: sheet });
    expect((sheet.appended[0] as string[])[HEADER.indexOf("담당자")]).toBe("김담당");
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
});
