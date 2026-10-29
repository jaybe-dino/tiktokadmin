// 수동 시트 갱신 처리 이력 — 권한 · CSRF · 건수 검증 · 중복/충돌 경계만 본다.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Ev { id: number; site: string; event: string; idem_key: string; payload: Record<string, unknown> }
const db = {
  events: [] as Ev[],
  insertThrows: false,
  listThrows: false,
  lastSql: "",
  lastArgs: null as unknown[] | null,
  seq: 0,
};

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    db.lastSql = sql; db.lastArgs = args;
    if (sql.includes("INSERT INTO ingest_events")) {
      if (db.insertThrows) throw new Error("permission denied for table ingest_events");
      const [site, event, idem, payload] = args as [string, string, string, string];
      if (db.events.some((e) => e.site === site && e.event === event && e.idem_key === idem)) return [];
      const row: Ev = { id: ++db.seq, site, event, idem_key: idem, payload: JSON.parse(payload) };
      db.events.push(row);
      return [{ id: String(row.id) }];
    }
    if (sql.includes("FROM ingest_events") && sql.includes("idem_key=$3")) {
      const [site, event, idem] = args as [string, string, string];
      const f = db.events.find((e) => e.site === site && e.event === event && e.idem_key === idem);
      return f ? [{ id: String(f.id), payload: f.payload }] : [];
    }
    if (sql.includes("FROM ingest_events")) {
      if (db.listThrows) throw new Error("permission denied for table ingest_events");
      const [site, event, sid] = args as [string, string, string];
      return db.events
        .filter((e) => e.site === site && e.event === event && e.payload.spreadsheetId === sid)
        .reverse()
        .slice(0, 20)
        .map((e) => ({ id: String(e.id), created_at: "2026-10-30T01:00:00Z", payload: e.payload }));
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

const session = { user: null as { id: string; role: string } | null };
vi.mock("@/lib/auth", () => ({ currentUser: async () => session.user }));
vi.mock("@/lib/env", async () => await import("../lib/env"));
vi.mock("@/lib/sheet-update-log", async () => await import("../lib/sheet-update-log"));

const route = await import("../app/api/admin/sheets-ledger/updates/route");
const L = await import("../lib/sheet-update-log");

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";

const GOOD = {
  runId: RUN_A,
  sourceCollectedAt: "2026-10-30T01:30:00+09:00",
  sourceCount: 1298,
  updatedRows: 960,
  appendedRows: 338,
  verifiedRows: 1298,
};

/** 같은 출처(브라우저 UI)에서 온 POST 처럼 꾸민 요청. */
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://admin.example.invalid/api/admin/sheets-ledger/updates", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://admin.example.invalid",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  db.events = []; db.seq = 0;
  db.insertThrows = false; db.listThrows = false;
  db.lastSql = ""; db.lastArgs = null;
  session.user = { id: "boss@example.invalid", role: "exec" };
});

describe("권한", () => {
  it("로그인하지 않으면 401 — GET·POST 모두", async () => {
    session.user = null;
    expect((await route.GET()).status).toBe(401);
    expect((await route.POST(post(GOOD))).status).toBe(401);
  });

  it("exec 가 아니면 403 — 다른 역할은 모두 막는다", async () => {
    for (const role of ["intake", "sales", "onboard", "ads", "settle", "lead"]) {
      session.user = { id: "u@example.invalid", role };
      expect((await route.GET()).status, role).toBe(403);
      expect((await route.POST(post(GOOD))).status, role).toBe(403);
    }
  });

  it("권한 없이는 아무것도 기록되지 않는다", async () => {
    session.user = { id: "u@example.invalid", role: "lead" };
    await route.POST(post(GOOD));
    expect(db.events).toHaveLength(0);
  });

  it("캐시에 남지 않는다", async () => {
    const res = await route.GET();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("교차 출처(CSRF) 차단", () => {
  it("다른 출처에서 온 POST 는 거부한다", async () => {
    const res = await route.POST(post(GOOD, { origin: "https://evil.example.invalid" }));
    expect(res.status).toBe(403);
    expect(db.events).toHaveLength(0);
  });

  it("sec-fetch-site 가 cross-site 면 거부한다", async () => {
    const res = await route.POST(post(GOOD, { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
  });

  it("출처 헤더가 아예 없으면(스크립트·curl) 거부한다", async () => {
    const req = new Request("https://admin.example.invalid/api/admin/sheets-ledger/updates", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(GOOD),
    }) as never;
    expect((await route.POST(req)).status).toBe(403);
    expect(db.events).toHaveLength(0);
  });

  it("JSON 이 아니면 거부한다", async () => {
    const res = await route.POST(post("runId=x", { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });
});

describe("입력 검증", () => {
  const bad = async (patch: Record<string, unknown>) => {
    const res = await route.POST(post({ ...GOOD, ...patch }));
    expect(res.status).toBe(400);
    expect(db.events).toHaveLength(0);
    return (await res.json()) as { ok: boolean; issues?: { field: string }[] };
  };

  it("기존갱신 + 신규 합이 대상과 다르면 거부한다", async () => {
    await bad({ updatedRows: 960, appendedRows: 337 });
  });

  it("검증 건수가 대상과 다르면 거부한다(부분 검증을 완료로 적지 않는다)", async () => {
    await bad({ verifiedRows: 1297 });
  });

  it("대상 건수는 0 이면 안 된다", async () => {
    await bad({ sourceCount: 0, updatedRows: 0, appendedRows: 0, verifiedRows: 0 });
  });

  it("음수·소수·문자는 거부한다", async () => {
    await bad({ updatedRows: -1, appendedRows: 1299 });
    await bad({ updatedRows: 960.5, appendedRows: 337.5 });
    await bad({ sourceCount: "1298" });
  });

  it("상한을 넘는 건수는 거부한다", async () => {
    const n = L.MAX_ROWS + 1;
    await bad({ sourceCount: n, updatedRows: n, appendedRows: 0, verifiedRows: n });
  });

  it("작업 번호는 UUID 여야 한다", async () => {
    await bad({ runId: "not-a-uuid" });
  });

  it("수집시각은 시간대를 명시해야 한다", async () => {
    await bad({ sourceCollectedAt: "2026-10-30T01:30:00" });     // 시간대 없음
    await bad({ sourceCollectedAt: "2026-10-30 01:30" });
  });

  it("시간대가 명시되면 Z 와 +09:00 모두 받는다", async () => {
    const a = await route.POST(post({ ...GOOD, sourceCollectedAt: "2026-10-29T16:30:00Z" }));
    expect(a.status).toBe(201);
    const b = await route.POST(post({ ...GOOD, runId: RUN_B }));
    expect(b.status).toBe(201);
  });

  it("모르는 키는 거부한다 — 시트 ID·연락처·금액·메모를 받지 않는다", async () => {
    await bad({ spreadsheetId: "OTHER_SHEET" });
    await bad({ email: "a@example.invalid" });
    await bad({ phone: "010-1111-2222" });
    await bad({ revenue: 100 });
    await bad({ note: "자유 메모" });
    await bad({ actor: "someone-else" });
    await bad({ verifiedMethod: "server_verified" });
  });

  it("본문이 깨져 있으면 400 이고 성공으로 감추지 않는다", async () => {
    const res = await route.POST(post("{not json", {}));
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });
});

describe("기록 내용", () => {
  it("시트 ID·검증방식·기록자는 서버가 정한다", async () => {
    await route.POST(post(GOOD));
    const p = db.events[0].payload;
    expect(p.spreadsheetId).toBe("SHEET1");
    expect(p.verifiedMethod).toBe("gpt_sheet_readback");   // 서버가 독립 검증한 척하지 않는다
    expect(p.actor).toBe("boss@example.invalid");
    expect(typeof p.recordedAt).toBe("string");
  });

  it("담는 키가 정해진 아홉 개뿐이다", async () => {
    await route.POST(post(GOOD));
    expect(Object.keys(db.events[0].payload).sort()).toEqual([
      "actor", "appendedRows", "recordedAt", "sourceCollectedAt", "sourceCount",
      "spreadsheetId", "updatedRows", "verifiedMethod", "verifiedRows",
    ]);
  });

  it("site·event 는 서버 고정값이다", async () => {
    await route.POST(post(GOOD));
    expect(db.events[0].site).toBe(L.LOG_SITE);
    expect(db.events[0].event).toBe(L.LOG_EVENT);
    expect(db.events[0].idem_key).toBe(RUN_A);
  });

  it("쓰기는 ingest_events INSERT 하나뿐이다(소스 표를 건드리지 않는다)", async () => {
    await route.POST(post(GOOD));
    expect(db.lastSql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b[\s\S]*\b(brands|email_messages|brand_emails)\b/i);
    expect(db.events).toHaveLength(1);
  });
});

describe("중복과 충돌", () => {
  it("같은 작업 번호 · 같은 내용은 같은 id 를 돌려준다(재시도 안전)", async () => {
    const a = await route.POST(post(GOOD));
    expect(a.status).toBe(201);
    const first = (await a.json()).id;

    const b = await route.POST(post(GOOD));
    expect(b.status).toBe(200);
    const body = await b.json();
    expect(body.id).toBe(first);
    expect(body.duplicate).toBe(true);
    expect(db.events).toHaveLength(1);     // 두 줄로 남지 않는다
  });

  it("같은 작업 번호 · 다른 내용은 409 로 막는다", async () => {
    await route.POST(post(GOOD));
    const res = await route.POST(post({ ...GOOD, updatedRows: 961, appendedRows: 337 }));
    expect(res.status).toBe(409);
    expect((await res.json()).ok).toBe(false);
    // 기존 기록을 덮어쓰지 않는다.
    expect(db.events).toHaveLength(1);
    expect(db.events[0].payload.updatedRows).toBe(960);
  });

  it("새 작업 번호면 따로 기록된다", async () => {
    await route.POST(post(GOOD));
    const res = await route.POST(post({ ...GOOD, runId: RUN_B }));
    expect(res.status).toBe(201);
    expect(db.events).toHaveLength(2);
  });
});

describe("조회", () => {
  it("이 이벤트 · 이 시트만, 최근 20건까지", async () => {
    for (let i = 0; i < 25; i += 1) {
      const id = `3333${String(i).padStart(4, "0")}-3333-4333-8333-333333333333`;
      await route.POST(post({ ...GOOD, runId: id }));
    }
    // 다른 시트·다른 이벤트 기록은 섞이지 않는다.
    db.events.push({ id: 999, site: L.LOG_SITE, event: L.LOG_EVENT, idem_key: "x",
      payload: { spreadsheetId: "OTHER", sourceCount: 7 } });
    db.events.push({ id: 998, site: "other", event: "other", idem_key: "y",
      payload: { spreadsheetId: "SHEET1", sourceCount: 7 } });

    const body = await (await route.GET()).json();
    expect(body.rows).toHaveLength(20);
    for (const r of body.rows) expect(r.sourceCount).toBe(1298);
  });

  it("연락처·금액·메모·시트 ID 를 응답에 담지 않는다", async () => {
    await route.POST(post(GOOD));
    const text = JSON.stringify(await (await route.GET()).json());
    expect(text).not.toContain("SHEET1");
    for (const bad of ["phone", "email", "revenue", "note", "token", "secret"]) {
      expect(text.includes(bad), bad).toBe(false);
    }
  });
});

describe("실패를 성공으로 감추지 않는다", () => {
  it("기록 중 DB 예외는 500 이고 사유 원문을 싣지 않는다", async () => {
    db.insertThrows = true;
    const res = await route.POST(post(GOOD));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("기록에 실패했습니다(DB).");
    expect(JSON.stringify(body)).not.toContain("permission denied");
  });

  it("조회 중 DB 예외도 500 이고 빈 목록으로 위장하지 않는다", async () => {
    db.listThrows = true;
    const res = await route.GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rows).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("permission denied");
  });
});

describe("KST → 시간대 명시 변환", () => {
  it("입력칸 값에 +09:00 을 붙인다", async () => {
    const { kstLocalToIso } = await import("../components/SheetUpdateLogCard");
    expect(kstLocalToIso("2026-10-30T01:30")).toBe("2026-10-30T01:30:00+09:00");
  });

  it("모양이 다르면 빈 문자열 — 시간대 없는 값을 보내지 않는다", async () => {
    const { kstLocalToIso } = await import("../components/SheetUpdateLogCard");
    expect(kstLocalToIso("")).toBe("");
    expect(kstLocalToIso("2026-10-30")).toBe("");
  });
});
