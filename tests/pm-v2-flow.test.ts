// PM 1차 확장 — 계약 조건·추출·업무 연결·알림을 가짜 DB 로 검증한다.
//   실제 발송(문자·메일·Slack)은 하지 않는다. 고객 발송 경로가 없다는 것도 함께 검사한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

interface Row { [k: string]: unknown }
const db = {
  v2: true,
  terms: [] as Row[],
  extractions: [] as Row[],
  tasks: [] as Row[],
  kpis: [] as Row[],
  taskEvents: [] as Row[],
  kpiEvents: [] as Row[],
  notify: {
    enabled: false, urgent_enabled: false, daily_enabled: false, weekly_enabled: false,
    daily_hour: 9, daily_minute: 10, weekly_weekday: 1, weekly_hour: 9, weekly_minute: 40,
    recipients: [] as string[], note: "", updated_by: null as string | null, updated_at: null as string | null,
  },
  notifyLog: [] as Row[],
  admins: [] as { id: string; active: boolean }[],
  digestRows: [] as Row[],
  slackSent: [] as { to: string; text: string }[],
  slackThrows: false,
  seq: 0,
};
const nid = (p: string) => `${p}${++db.seq}`;
const B = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Row[]> => {
    const a = args as never[] as (string | number | boolean | string[] | null)[];

    if (sql.includes("information_schema.tables")) {
      return db.v2 ? (a[0] as string[]).map((t) => ({ table_name: t })) : [];
    }
    if (sql.includes("information_schema.columns")) {
      return db.v2 ? (a[0] as string[]).map((c) => ({ column_name: c })) : [];
    }

    // ── 계약 조건 ──
    if (sql.includes("INSERT INTO pm_contract_terms")) {
      const row: Row = {
        id: nid("tm"), brand_id: a[0], kind: a[1], label: a[2], detail: a[3], quantity: a[4], unit: a[5],
        period_start: a[6], period_end: a[7], status: a[8], evidence_label: a[9], evidence_url: a[10],
        source_quote: a[11], source_author: a[12], source_at: a[13],
        confirmed_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
      };
      db.terms.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("FROM pm_contract_terms WHERE id=$1 AND brand_id=$2")) {
      const t = db.terms.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return t ? [{ ...t }] : [];
    }
    if (sql.includes("UPDATE pm_contract_terms SET status='agreed'")) {
      const t = db.terms.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (!t) return [];
      t.status = "agreed"; t.confirmed_by = a[2];
      return [{ id: t.id }];
    }
    if (sql.includes("UPDATE pm_contract_terms SET kind=")) {
      const t = db.terms.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (!t) return [];
      Object.assign(t, { kind: a[2], label: a[3], detail: a[4], quantity: a[5], unit: a[6], status: a[9] });
      return [{ id: t.id }];
    }
    if (sql.includes("DELETE FROM pm_contract_terms")) {
      const i = db.terms.findIndex((x) => x.id === a[0] && x.brand_id === a[1]);
      if (i < 0) return [];
      const [t] = db.terms.splice(i, 1);
      return [{ id: t.id }];
    }
    if (sql.includes("FROM pm_contract_terms WHERE brand_id=$1")) {
      return db.terms.filter((t) => t.brand_id === a[0]).map((t) => ({ ...t }));
    }

    // ── 추출 ──
    if (sql.includes("INSERT INTO pm_extractions")) {
      const key = a[17];
      if (key) {
        const dup = db.extractions.find((e) => e.brand_id === a[0] && e.dedupe_key === key);
        if (dup) {
          // ON CONFLICT DO UPDATE ... WHERE edited_by_human=false AND status IN ('new','confirmed')
          if (!dup.edited_by_human && ["new", "confirmed"].includes(String(dup.status))) {
            Object.assign(dup, { contract_check: a[13], contract_term_id: a[14], contract_note: a[15] });
            return [{ id: dup.id, inserted: false }];
          }
          return [];
        }
      }
      const row: Row = {
        id: nid("ex"), brand_id: a[0], kind: a[1], title: a[2], detail: a[3],
        evidence_kind: a[4], evidence_id: a[5], evidence_url: a[6], evidence_label: a[7],
        source_quote: a[8], source_author: a[9], occurred_at: a[10],
        reply_draft: a[11], internal_checks: a[12],
        contract_check: a[13], contract_term_id: a[14], contract_note: a[15],
        origin: a[16], dedupe_key: a[17], created_by: a[18],
        status: "new", edited_by_human: false, confirmed_by: null, answered_by: null,
        created_at: "2026-10-01T00:00:00Z",
      };
      db.extractions.push(row);
      return [{ id: row.id, inserted: true }];
    }
    if (sql.includes("FROM pm_extractions WHERE id=$1 AND brand_id=$2")) {
      const e = db.extractions.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return e ? [{ ...e }] : [];
    }
    if (sql.includes("UPDATE pm_extractions SET status=")) {
      const e = db.extractions.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (!e) return [];
      e.status = a[2];
      if (a[2] === "confirmed") e.confirmed_by = a[3];
      if (a[2] === "answered") e.answered_by = a[3];
      return [{ id: e.id }];
    }
    if (sql.includes("UPDATE pm_extractions SET") && sql.includes("reply_draft=COALESCE")) {
      const e = db.extractions.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (!e) return [];
      if (a[2] !== null) e.reply_draft = a[2];
      if (a[3] !== null) e.internal_checks = a[3];
      if (a[4] !== null) e.contract_note = a[4];
      if (a[5] !== null) e.contract_check = a[5];
      e.edited_by_human = true;
      return [{ id: e.id }];
    }
    if (sql.includes("UPDATE pm_extractions SET contract_check=$3")) {
      const e = db.extractions.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (e) Object.assign(e, { contract_check: a[2], contract_term_id: a[3], contract_note: a[4] });
      return [];
    }
    if (sql.includes("FROM pm_extractions") && sql.includes("edited_by_human=false")) {
      return db.extractions
        .filter((e) => e.brand_id === a[0] && !e.edited_by_human && ["new", "confirmed"].includes(String(e.status)))
        .map((e) => ({ id: e.id, title: e.title, detail: e.detail, source_quote: e.source_quote }));
    }
    if (sql.includes("FROM pm_extractions e WHERE e.brand_id=$1")) {
      return db.extractions.filter((e) => e.brand_id === a[0]).map((e) => ({
        ...e, task_id: db.tasks.find((t) => t.extraction_id === e.id)?.id ?? null,
      }));
    }
    if (sql.includes("FROM pm_extractions WHERE brand_id=$1")) {
      return db.extractions.filter((e) => e.brand_id === a[0]).map((e) => ({ ...e }));
    }

    // ── 업무 ──
    if (sql.includes("SELECT id FROM pm_tasks WHERE extraction_id=$1")) {
      const t = db.tasks.find((x) => x.extraction_id === a[0] && x.brand_id === a[1]);
      return t ? [{ id: t.id }] : [];
    }
    if (sql.includes("INSERT INTO pm_tasks")) {
      const key = a[11];
      if (key && db.tasks.some((t) => t.brand_id === a[0] && t.dedupe_key === key)) return [];
      const row: Row = {
        id: nid("tk"), brand_id: a[0], kind: a[1], title: a[2], detail: a[3], priority: 2,
        owner_admin_id: a[4], due_date: a[5], status: "open", origin: "human", confirmed_by: a[6],
        evidence_kind: a[7], evidence_id: a[8], evidence_url: a[9], evidence_label: a[10],
        dedupe_key: a[11], kpi_id: a[12], extraction_id: a[13], waiting_on: a[14],
        result_note: "", result_evidence: "", result_at: null, edited_by_human: false,
      };
      db.tasks.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("SELECT id FROM pm_tasks WHERE brand_id=$1 AND dedupe_key=$2")) {
      const t = db.tasks.find((x) => x.brand_id === a[0] && x.dedupe_key === a[1]);
      return t ? [{ id: t.id }] : [];
    }
    if (sql.includes("SELECT waiting_on FROM pm_tasks")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return t ? [{ waiting_on: t.waiting_on }] : [];
    }
    if (sql.includes("UPDATE pm_tasks SET waiting_on=$3")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (t) { t.waiting_on = a[2]; t.edited_by_human = true; }
      return [];
    }
    if (sql.includes("UPDATE pm_tasks SET kpi_id=$3")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (!t) return [];
      t.kpi_id = a[2];
      return [{ id: t.id }];
    }
    if (sql.includes("SELECT status, result_evidence FROM pm_tasks")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return t ? [{ status: t.status, result_evidence: t.result_evidence }] : [];
    }
    if (sql.includes("UPDATE pm_tasks SET result_note=")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (!t) return [];
      if (a[2] !== null) t.result_note = a[2];
      t.result_evidence = a[3];
      if (a[4]) { t.status = "done"; t.result_at = "2026-10-01T00:00:00Z"; t.waiting_on = "none"; }
      return [];
    }
    if (sql.includes("INSERT INTO pm_task_events")) { db.taskEvents.push({ sql, args: a }); return []; }
    if (sql.includes("FROM pm_tasks t LEFT JOIN pm_kpis k")) {
      return db.tasks.filter((t) => t.brand_id === a[0]).map((t) => ({
        ...t, due_date: t.due_date, kpi_name: db.kpis.find((k) => k.id === t.kpi_id)?.name ?? null,
      }));
    }
    if (sql.includes("FROM pm_tasks WHERE brand_id=$1")) {
      return db.tasks.filter((t) => t.brand_id === a[0]).map((t) => ({ ...t }));
    }

    // ── KPI ──
    if (sql.includes("SELECT kind, agreement FROM pm_kpis")) {
      const k = db.kpis.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return k ? [{ kind: k.kind, agreement: k.agreement }] : [];
    }
    if (sql.includes("SELECT agreement, source_quote, evidence")) {
      const k = db.kpis.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return k ? [{ agreement: k.agreement, source_quote: k.source_quote, evidence: k.evidence, evidence_id: k.evidence_id }] : [];
    }
    if (sql.includes("SELECT id FROM pm_kpis WHERE id=$1 AND brand_id=$2")) {
      const k = db.kpis.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return k ? [{ id: k.id }] : [];
    }
    if (sql.includes("UPDATE pm_kpis SET kind=$3")) {
      const k = db.kpis.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (k) {
        k.kind = a[2]; k.agreement = a[3];
        if (a[4] !== null) k.source_quote = a[4];
        k.edited_by_human = true;
      }
      return [];
    }
    if (sql.includes("UPDATE pm_kpis SET agreement='agreed'")) {
      const k = db.kpis.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (k) { k.agreement = "agreed"; k.confirmed_by = a[2]; }
      return [];
    }
    if (sql.includes("INSERT INTO pm_kpi_events")) { db.kpiEvents.push({ args: a }); return []; }
    if (sql.includes("FROM pm_kpi_events")) {
      return db.kpiEvents.filter((e) => (e.args as string[])[0] === a[0]).map((e) => {
        const g = e.args as string[];
        return { field: g[2], old_value: g[3], new_value: g[4], actor: g[5], note: g[6] ?? "", at: "2026-10-01T00:00:00Z" };
      });
    }
    if (sql.includes("FROM pm_kpis WHERE brand_id=$1")) {
      return db.kpis.filter((k) => k.brand_id === a[0]).map((k) => ({ ...k }));
    }

    // ── 알림 ──
    if (sql.includes("FROM pm_notify_config")) return [{ ...db.notify }];
    if (sql.includes("UPDATE pm_notify_config SET")) {
      const sets = sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).split(",").map((x) => x.trim());
      sets.forEach((s) => {
        const m = s.match(/^(\w+)=\$(\d+)$/);
        if (m) (db.notify as unknown as Row)[m[1]] = a[Number(m[2]) - 1];
      });
      return [];
    }
    if (sql.includes("FROM admin_users WHERE id = ANY")) {
      const want = a[0] as string[];
      return db.admins.filter((x) => want.includes(x.id) && x.active).map((x) => ({ id: x.id }));
    }
    if (sql.includes("FROM pm_tasks t") && sql.includes("JOIN pm_brand_config p")) {
      return db.digestRows.map((r) => ({ ...r }));
    }
    if (sql.includes("INSERT INTO pm_notify_log")) {
      if (db.notifyLog.some((l) => l.kind === a[0] && l.recipient === a[1] && l.period_key === a[2])) return [];
      const row: Row = {
        id: nid("nl"), kind: a[0], recipient: a[1], period_key: a[2],
        brand_count: a[3], item_count: a[4], body_preview: a[5], status: "queued",
        error: "", skip_reason: "", channel: "slack", created_at: "2026-10-01T00:00:00Z", sent_at: null,
      };
      db.notifyLog.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("UPDATE pm_notify_log SET status='skipped'")) {
      const l = db.notifyLog.find((x) => x.id === a[0]);
      if (l) { l.status = "skipped"; l.skip_reason = a[1]; }
      return [];
    }
    if (sql.includes("UPDATE pm_notify_log SET status='sent'")) {
      const l = db.notifyLog.find((x) => x.id === a[0]);
      if (l) { l.status = "sent"; l.sent_at = "now"; }
      return [];
    }
    if (sql.includes("UPDATE pm_notify_log SET status='failed'")) {
      const l = db.notifyLog.find((x) => x.id === a[0]);
      if (l) { l.status = "failed"; l.error = a[1]; }
      return [];
    }
    if (sql.includes("FROM pm_notify_log ORDER BY")) return db.notifyLog.map((l) => ({ ...l }));
    return [];
  };
  const client = { query: async (sql: string, args: unknown[] = []) => ({ rows: await run(sql, args), rowCount: 0 }) };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    tx: async <T,>(fn: (c: typeof client) => Promise<T>): Promise<T> => fn(client),
  };
});

vi.mock("../lib/slack", () => ({
  slackPostDM: async (to: string, args: { text?: string }) => {
    if (db.slackThrows) throw new Error("slack 실패(모의)");
    db.slackSent.push({ to, text: args.text ?? "" });
  },
}));

const V2 = await import("../lib/pm-v2");
const N = await import("../lib/pm-notify");

function reset() {
  db.v2 = true; db.seq = 0;
  db.terms = []; db.extractions = []; db.tasks = []; db.kpis = [];
  db.taskEvents = []; db.kpiEvents = []; db.notifyLog = []; db.digestRows = [];
  db.slackSent = []; db.slackThrows = false;
  db.admins = [{ id: "a@b.c", active: true }, { id: "off@b.c", active: false }];
  db.notify = {
    enabled: false, urgent_enabled: false, daily_enabled: false, weekly_enabled: false,
    daily_hour: 9, daily_minute: 10, weekly_weekday: 1, weekly_hour: 9, weekly_minute: 40,
    recipients: [], note: "", updated_by: null, updated_at: null,
  };
}
beforeEach(reset);

describe("스키마 확인", () => {
  it("0104 미적용이면 사유를 알려준다", async () => {
    db.v2 = false;
    const s = await V2.pmV2Schema();
    expect(s.ready).toBe(false);
    expect(s.missing.length).toBeGreaterThan(0);
    const h = await V2.pmHeaderSummary(B);
    expect(h.unavailable).toContain("0104");
  });
});

describe("② 계약 조건", () => {
  it("근거 없이는 확정할 수 없다", async () => {
    const id = await V2.createContractTerm(B, { kind: "quantity", label: "월 시딩 20건", quantity: 20, unit: "건" }, "a@b.c");
    const r = await V2.confirmContractTerm(id, B, "a@b.c");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("근거");
    expect(db.terms[0].status).toBe("candidate");
  });
  it("근거가 있으면 확정된다", async () => {
    const id = await V2.createContractTerm(B, { label: "월 시딩", sourceQuote: "계약서 3조: 월 20건" }, "a@b.c");
    expect((await V2.confirmContractTerm(id, B, "a@b.c")).ok).toBe(true);
    expect(db.terms[0].status).toBe("agreed");
  });
  it("다른 브랜드의 계약 조건은 건드릴 수 없다", async () => {
    const id = await V2.createContractTerm(B, { label: "x", sourceQuote: "q" }, "a@b.c");
    expect((await V2.confirmContractTerm(id, OTHER, "a@b.c")).ok).toBe(false);
    expect((await V2.updateContractTerm(id, OTHER, { label: "바꿈" })).ok).toBe(false);
    expect((await V2.deleteContractTerm(id, OTHER)).ok).toBe(false);
    expect(db.terms).toHaveLength(1);
  });
  it("수량 미입력과 0 을 구분한다", async () => {
    await V2.createContractTerm(B, { label: "미입력" }, "a@b.c");
    await V2.createContractTerm(B, { label: "영", quantity: 0 }, "a@b.c");
    const list = await V2.listContractTerms(B);
    expect(list.find((t) => t.label === "미입력")!.quantity).toBeNull();
    expect(list.find((t) => t.label === "영")!.quantity).toBe(0);
  });
});

describe("② KPI 분류·확정", () => {
  beforeEach(() => {
    db.kpis = [{
      id: "k1", brand_id: B, name: "월 라이브", unit: "회", kind: "internal", agreement: "candidate",
      target_value: "4", current_value: null, measured_at: null, direction: "up",
      period_start: null, period_end: null, owner_admin_id: null,
      source_quote: "", evidence: "", evidence_id: "", status: "active",
    }];
  });
  it("근거 없는 후보는 합의로 확정되지 않는다", async () => {
    const r = await V2.confirmKpi("k1", B, "a@b.c");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("근거");
    expect(db.kpis[0].agreement).toBe("candidate");
  });
  it("근거를 적으면 확정되고 이력이 남는다", async () => {
    await V2.setKpiClass("k1", B, { kind: "contract", sourceQuote: "회의록: 월 4회 라이브" }, "a@b.c");
    const r = await V2.confirmKpi("k1", B, "a@b.c");
    expect(r.ok).toBe(true);
    expect(db.kpis[0].agreement).toBe("agreed");
    const ev = await V2.listKpiEvents("k1", B);
    expect(ev.some((e) => e.field === "kind")).toBe(true);
    expect(ev.some((e) => e.field === "agreement" && e.newValue === "agreed")).toBe(true);
  });
  it("다른 브랜드 KPI 는 분류를 바꿀 수 없다", async () => {
    const r = await V2.setKpiClass("k1", OTHER, { kind: "contract" }, "a@b.c");
    expect(r.ok).toBe(false);
    expect(db.kpis[0].kind).toBe("internal");
  });
  it("미확인 실적은 0 이 아니라 null 로 읽힌다", async () => {
    const list = await V2.listKpisForBrief(B);
    expect(list[0].current).toBeNull();
    expect(list[0].target).toBe(4);
  });
});

describe("③ 추출 · 계약 대조", () => {
  it("같은 근거·종류는 다시 만들지 않는다(반복 실행 중복 방지)", async () => {
    const input = { kind: "request" as const, title: "촬영 추가 요청", dedupeKey: "ai:m1:request", origin: "ai" as const };
    const a1 = await V2.upsertExtraction(B, input, "sys");
    const a2 = await V2.upsertExtraction(B, input, "sys");
    expect(a1.created).toBe(true);
    expect(a2.created).toBe(false);
    expect(db.extractions).toHaveLength(1);
  });
  it("사람이 고친 항목은 자동 실행이 덮어쓰지 않는다", async () => {
    await V2.upsertExtraction(B, { kind: "request", title: "요청", dedupeKey: "ai:m1:request", origin: "ai" }, "sys");
    await V2.editExtraction(db.extractions[0].id as string, B, { replyDraft: "사람이 쓴 초안" });
    await V2.upsertExtraction(B, { kind: "request", title: "요청", dedupeKey: "ai:m1:request", origin: "ai", contractCheck: "conflict" }, "sys");
    expect(db.extractions[0].reply_draft).toBe("사람이 쓴 초안");
    expect(db.extractions[0].contract_check).not.toBe("conflict");
  });
  it("계약 조건이 없으면 대조 불가로 남는다", async () => {
    await V2.upsertExtraction(B, { kind: "request", title: "영상 촬영 요청", dedupeKey: "k1", origin: "ai" }, "sys");
    const r = await V2.recheckContracts(B);
    expect(r.unknown).toBe(1);
    expect(db.extractions[0].contract_check).toBe("unknown");
  });
  it("제외 항목과 겹치면 계약 충돌로 표시된다", async () => {
    const id = await V2.createContractTerm(B, { kind: "exclusion", label: "영상 촬영", sourceQuote: "촬영 제외" }, "a@b.c");
    await V2.confirmContractTerm(id, B, "a@b.c");
    await V2.upsertExtraction(B, { kind: "request", title: "영상 촬영 추가 부탁드립니다", dedupeKey: "k1", origin: "ai" }, "sys");
    await V2.recheckContracts(B);
    expect(db.extractions[0].contract_check).toBe("conflict");
    expect(String(db.extractions[0].contract_note)).toContain("제외");
  });
  it("다른 브랜드 항목은 상태를 바꿀 수 없다", async () => {
    await V2.upsertExtraction(B, { kind: "question", title: "q", dedupeKey: null, origin: "human" }, "a@b.c");
    const id = db.extractions[0].id as string;
    expect((await V2.setExtractionStatus(id, OTHER, "answered", "a@b.c")).ok).toBe(false);
    expect((await V2.editExtraction(id, OTHER, { replyDraft: "x" })).ok).toBe(false);
    expect(db.extractions[0].status).toBe("new");
  });
});

describe("④ 추출 → 업무 (중복 업무 방지)", () => {
  beforeEach(async () => {
    await V2.upsertExtraction(B, { kind: "request", title: "인증 서류 요청", dedupeKey: "ai:m1:request", origin: "ai" }, "sys");
  });
  it("같은 추출로 업무는 한 번만 생긴다", async () => {
    const id = db.extractions[0].id as string;
    const r1 = await V2.taskFromExtraction(id, B, {}, "a@b.c");
    const r2 = await V2.taskFromExtraction(id, B, {}, "a@b.c");
    expect(r1.already).toBeUndefined();
    expect(r2.already).toBe(true);
    expect(r2.taskId).toBe(r1.taskId);
    expect(db.tasks).toHaveLength(1);
    expect(db.tasks[0].dedupe_key).toBe(`ext:${id}`);
  });
  it("만든 업무는 사람이 확정한 것으로 기록되고 근거를 이어받는다", async () => {
    const id = db.extractions[0].id as string;
    db.extractions[0].evidence_label = "카카오톡 · 9/28";
    await V2.taskFromExtraction(id, B, { waitingOn: "customer" }, "a@b.c");
    expect(db.tasks[0].origin).toBe("human");
    expect(db.tasks[0].confirmed_by).toBe("a@b.c");
    expect(db.tasks[0].evidence_label).toBe("카카오톡 · 9/28");
    expect(db.tasks[0].waiting_on).toBe("customer");
  });
  it("다른 브랜드 추출로는 업무를 만들 수 없다", async () => {
    const r = await V2.taskFromExtraction(db.extractions[0].id as string, OTHER, {}, "a@b.c");
    expect(r.ok).toBe(false);
    expect(db.tasks).toHaveLength(0);
  });
});

describe("④ 업무 실행결과 · 완료 근거", () => {
  beforeEach(async () => {
    await V2.upsertExtraction(B, { kind: "todo" as never, title: "t", dedupeKey: "x", origin: "ai" }, "sys");
    await V2.taskFromExtraction(db.extractions[0].id as string, B, {}, "a@b.c");
  });
  it("완료 근거가 없으면 완료로 넘기지 않는다", async () => {
    const id = db.tasks[0].id as string;
    const r = await V2.setTaskResult(id, B, { resultNote: "했습니다", complete: true }, "a@b.c");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("완료 근거");
    expect(db.tasks[0].status).toBe("open");
  });
  it("근거가 있으면 완료되고 이력에 근거가 남는다", async () => {
    const id = db.tasks[0].id as string;
    const r = await V2.setTaskResult(id, B, { resultNote: "발송", resultEvidence: "메일 링크", complete: true }, "a@b.c");
    expect(r.ok).toBe(true);
    expect(db.tasks[0].status).toBe("done");
    expect(db.tasks[0].result_evidence).toBe("메일 링크");
    expect(JSON.stringify(db.taskEvents)).toContain("완료 근거");
  });
  it("결과만 저장하면 상태는 그대로다", async () => {
    const id = db.tasks[0].id as string;
    await V2.setTaskResult(id, B, { resultNote: "진행 중" }, "a@b.c");
    expect(db.tasks[0].status).toBe("open");
  });
  it("대기 주체를 바꾸면 이력이 남는다", async () => {
    const id = db.tasks[0].id as string;
    expect((await V2.setTaskWaiting(id, B, "customer", "a@b.c")).ok).toBe(true);
    expect(db.tasks[0].waiting_on).toBe("customer");
    expect(JSON.stringify(db.taskEvents)).toContain("waiting_on");
  });
  it("다른 브랜드 KPI 는 업무에 붙일 수 없다", async () => {
    db.kpis = [{ id: "kX", brand_id: OTHER, name: "남의 KPI", status: "active" }];
    const r = await V2.setTaskKpi(db.tasks[0].id as string, B, "kX", "a@b.c");
    expect(r.ok).toBe(false);
    expect(db.tasks[0].kpi_id).toBeNull();
  });
  it("같은 브랜드 KPI 는 연결된다", async () => {
    db.kpis = [{ id: "kOK", brand_id: B, name: "우리 KPI", status: "active" }];
    expect((await V2.setTaskKpi(db.tasks[0].id as string, B, "kOK", "a@b.c")).ok).toBe(true);
    expect(db.tasks[0].kpi_id).toBe("kOK");
  });
});

describe("⑤ 내부 알림 — 수신자 확정 전 발송 OFF", () => {
  it("기본값은 꺼져 있다", async () => {
    const c = await N.getPmNotifyConfig();
    expect(c.enabled).toBe(false);
    expect(c.recipients).toEqual([]);
  });
  it("수신자 없이 켤 수 없다", async () => {
    const r = await N.updatePmNotifyConfig({ enabled: true }, "a@b.c");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("수신자");
    expect(db.notify.enabled).toBe(false);
  });
  it("수신자는 활성 어드민만 등록된다(고객 주소 차단)", async () => {
    const bad = await N.updatePmNotifyConfig({ recipients: ["brand@customer.com"] }, "a@b.c");
    expect(bad.ok).toBe(false);
    const off = await N.updatePmNotifyConfig({ recipients: ["off@b.c"] }, "a@b.c");
    expect(off.ok).toBe(false);
    const ok = await N.updatePmNotifyConfig({ recipients: ["a@b.c"] }, "a@b.c");
    expect(ok.ok).toBe(true);
    expect(db.notify.recipients).toEqual(["a@b.c"]);
  });
  it("꺼져 있으면 아무것도 보내지 않고 사유를 알려준다", async () => {
    await N.updatePmNotifyConfig({ recipients: ["a@b.c"], dailyEnabled: true }, "a@b.c");
    db.digestRows = [{
      brand_id: B, brand_name: "테스트", id: "t1", kind: "todo", title: "지연 업무",
      priority: 1, owner_admin_id: "a@b.c", due_date: "2026-09-01", status: "open",
      waiting_on: "none", origin: "human", confirmed_by: "a@b.c", kpi_id: null,
    }];
    const r = await N.runPmNotify("daily", { today: "2026-10-01" });
    expect(r.sent).toBe(0);
    expect(db.slackSent).toEqual([]);
    expect(r.blocked.join()).toContain("마스터");
    expect(db.notifyLog[0].status).toBe("skipped");
  });
  it("켜면 담당자에게만 보내고 같은 기간에 두 번 보내지 않는다", async () => {
    await N.updatePmNotifyConfig({ recipients: ["a@b.c"], dailyEnabled: true }, "a@b.c");
    await N.updatePmNotifyConfig({ enabled: true }, "a@b.c");
    db.digestRows = [{
      brand_id: B, brand_name: "테스트", id: "t1", kind: "todo", title: "지연 업무",
      priority: 1, owner_admin_id: "a@b.c", due_date: "2026-09-01", status: "open",
      waiting_on: "none", origin: "human", confirmed_by: "a@b.c", kpi_id: null,
    }];
    const first = await N.runPmNotify("daily", { today: "2026-10-01" });
    expect(first.sent).toBe(1);
    expect(db.slackSent).toHaveLength(1);
    expect(db.slackSent[0].to).toBe("a@b.c");

    const second = await N.runPmNotify("daily", { today: "2026-10-01" });
    expect(second.sent).toBe(0);
    expect(second.duplicate).toBe(1);
    expect(db.slackSent).toHaveLength(1);
  });
  it("보낼 항목이 없으면 보내지 않는다", async () => {
    await N.updatePmNotifyConfig({ recipients: ["a@b.c"], dailyEnabled: true }, "a@b.c");
    await N.updatePmNotifyConfig({ enabled: true }, "a@b.c");
    db.digestRows = [];
    const r = await N.runPmNotify("daily", { today: "2026-10-01" });
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(db.slackSent).toEqual([]);
  });
  it("전송 실패는 원장에 실패로 남는다", async () => {
    await N.updatePmNotifyConfig({ recipients: ["a@b.c"], dailyEnabled: true }, "a@b.c");
    await N.updatePmNotifyConfig({ enabled: true }, "a@b.c");
    db.slackThrows = true;
    db.digestRows = [{
      brand_id: B, brand_name: "테스트", id: "t1", kind: "todo", title: "업무",
      priority: 1, owner_admin_id: "a@b.c", due_date: "2026-09-01", status: "open",
      waiting_on: "none", origin: "human", confirmed_by: "a@b.c", kpi_id: null,
    }];
    const r = await N.runPmNotify("daily", { today: "2026-10-01" });
    expect(r.failed).toBe(1);
    expect(db.notifyLog[0].status).toBe("failed");
  });
  it("안내 본문에 도구·모델 이름이나 'sent using' 문구가 없다", async () => {
    const body = N.renderDigest("daily", {
      recipient: "a@b.c", itemCount: 1,
      brands: [{ brandId: B, brandName: "테스트", overdue: [{ id: "t", kind: "todo", title: "지연", priority: 1, owner: null, dueDate: "2026-09-01", status: "open", waitingOn: "none", origin: "human", confirmedBy: null, kpiId: null }], today: [], waiting: [] }],
    }, "2026-10-01");
    expect(body.toLowerCase()).not.toContain("sent using");
    expect(body.toLowerCase()).not.toContain("chatgpt");
    expect(body.toLowerCase()).not.toContain("claude");
    expect(body).toContain("내부 공유용");
  });
  it("기간 키가 종류별로 다르다(중복 방지 단위)", () => {
    expect(N.periodKeyFor("daily", "2026-10-01")).toBe("d:2026-10-01");
    expect(N.periodKeyFor("weekly", "2026-10-01")).toBe("w:2026-09-28");
    expect(N.periodKeyFor("urgent", "2026-10-01", "t9")).toBe("u:t9");
  });
});

describe("배선 감사", () => {
  it("0104 마이그레이션은 추가만 한다", () => {
    const sql = read("../migrations/0104_pm_v2.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS pm_contract_terms");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS pm_extractions");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS waiting_on");
    expect(sql.replace(/ON DELETE (CASCADE|SET NULL)/g, "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/i);
  });
  it("알림 기본값이 꺼져 있고 수신자가 비어 있다", () => {
    const sql = read("../migrations/0104_pm_v2.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS pm_notify_config[\s\S]*?enabled boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/recipients text\[\] NOT NULL DEFAULT '\{\}'/);
  });
  it("모든 PM v2 서버액션이 브랜드 가드를 지난다", () => {
    const src = read("../app/(dash)/brand/[id]/pm-actions.ts");
    const v2 = src.slice(src.indexOf("PM 1차 확장 —"));
    const names = [...v2.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const n of names) {
      // 알림 설정은 브랜드 단위가 아니라 전역이라 역할 검사로 막는다.
      if (n.startsWith("pmSaveNotify") || n.startsWith("pmPreviewNotify")) {
        const body = v2.slice(v2.indexOf(`export async function ${n}`));
        expect(body.slice(0, 500), n).toContain("currentUser");
        continue;
      }
      const body = v2.slice(v2.indexOf(`export async function ${n}`));
      expect(body.slice(0, 400), n).toMatch(/brandAccess\(brandId\)|guard\(brandId/);
    }
    expect(v2).toContain("a.access.brandId");
  });
  it("PM 화면·모듈에 고객 발송 경로가 없다", () => {
    for (const f of ["../lib/pm-v2.ts", "../lib/pm-extract-run.ts", "../lib/pm-history.ts",
                     "../components/BrandPmV2Panel.tsx", "../components/BrandPmHeader.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/sendEmail|sendSms|sendMass|bulkSend/);
    }
    // 내부 알림만 Slack DM 을 쓰고, 대상은 admin_users 로 제한한다.
    const notify = read("../lib/pm-notify.ts");
    expect(notify).toContain("slackPostDM");
    expect(notify).not.toMatch(/sendEmail|sendSms/);
    expect(notify).toContain("admin_users");
  });
  it("Slack 질의는 권한 가드를 지나고 본인에게만 답한다", () => {
    const src = read("../app/api/slack/commands/route.ts");
    expect(src).toContain('case "/pm"');
    expect(src).toContain("resolveSlackActor");
    expect(src).toContain("brandAccessFor");
    expect(src).toContain("resolveBrandStrict");
    expect(src.toLowerCase()).not.toContain("sent using");
  });
  it("상단 요약이 브랜드360 에 붙어 있고 권한 가드를 지난다", () => {
    const page = read("../app/(dash)/brand/[id]/page.tsx");
    expect(page).toContain("BrandPmHeader");
    expect(page).toContain("brandAccess(brand.id)");
    expect(page).toContain("noIngestCaveats");
  });
  it("성과 API 연동·인사이트는 이번 범위에 넣지 않았다(이력만 확보)", () => {
    const sql = read("../migrations/0104_pm_v2.sql");
    expect(sql).toContain("pm_kpi_events");
    expect(sql).toMatch(/성과 API 연동·인사이트는 이번 범위가 아니다/);
  });
});
