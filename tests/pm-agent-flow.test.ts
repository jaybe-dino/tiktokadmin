// PM 에이전트 통합 — 제안 저장·중복 방지·사람 편집 보존·트랜잭션·동시실행/복구·AI 모드 표시.
//   DB·AI·대화조회를 모두 가짜로 둔다. 실제 발송·외부 호출은 없다.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface TaskRow {
  id: string; brand_id: string; kind: string; title: string; detail: string; priority: number;
  owner_admin_id: string | null; due_date: string | null; status: string; origin: string;
  confirmed_by: string | null; dedupe_key: string | null; edited_by_human: boolean;
  evidence_kind: string; evidence_id: string; evidence_url: string; evidence_label: string;
  created_by: string | null; created_at: string; updated_at: string;
}
interface RunRow { id: string; brand_id: string; mode: string; status: string; summary: string; error: string | null; started_at: number; triggered_by: string; created_count: number; skipped_count: number }

const db = {
  now: Date.UTC(2026, 8, 27, 3, 0, 0),
  brands: [] as { id: string; brand_name: string; state: string; last_contact_at: string | null; is_test: boolean }[],
  tasks: [] as TaskRow[],
  events: [] as { task_id: string; brand_id: string; field: string; old_value: string; new_value: string; actor: string }[],
  runs: [] as RunRow[],
  config: [] as { brand_id: string; enabled: boolean; owner_admin_id: string | null; last_run_at: number | null; last_run_mode: string | null; last_status: string | null; last_error: string | null; last_summary: string; next_action: string; note: string }[],
  kpis: [] as { id: string; brand_id: string; name: string; unit: string; target_value: number | null; current_value: number | null; measured_at: string | null; direction: string; period_start: string | null; period_end: string | null; owner_admin_id: string | null; evidence: string; source: string; source_ref: string; status: string }[],
  failEventInsert: false,
  /** 이 브랜드의 사실 수집만 실패시킨다(실패 경로 검증용). */
  failFactsFor: null as string | null,
  seq: 0,
};

const B = "11111111-1111-4111-8111-111111111111";
const TEST_B = "99999999-9999-4999-8999-999999999999";

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const a = args as (string | number | boolean | null)[];

    if (sql.includes("information_schema.tables")) {
      return ["pm_brand_config", "pm_kpis", "pm_tasks", "pm_task_events", "pm_manual_comms", "pm_runs"]
        .map((t) => ({ table_name: t }));
    }
    if (sql.includes("SELECT brand_name, state, last_contact_at")) {
      if (db.failFactsFor && a[0] === db.failFactsFor) throw new Error("사실 수집 실패(모의)");
      const b = db.brands.find((x) => x.id === a[0]);
      return b ? [{ brand_name: b.brand_name, state: b.state, last_contact_at: b.last_contact_at }] : [];
    }
    if (sql.includes("FROM meetings")) return [];
    if (sql.includes("FROM contracts") || sql.includes("FROM proposals")) return [];

    // pm_runs
    if (sql.includes("INSERT INTO pm_runs")) {
      if (db.runs.some((r) => r.brand_id === a[0] && r.status === "running")) {
        throw new Error('duplicate key value violates unique constraint "pm_runs_one_running"');
      }
      const row: RunRow = {
        id: `run${++db.seq}`, brand_id: String(a[0]), mode: String(a[1] ?? "rules"), status: "running",
        summary: "", error: null, started_at: db.now, triggered_by: String(a[2] ?? "manual"),
        created_count: 0, skipped_count: 0,
      };
      db.runs.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("UPDATE pm_runs SET status='error', finished_at=now()")) {
      const hit = db.runs.filter((r) => r.status === "running" && r.started_at < db.now - Number(a[0]) * 60_000
        && (a.length < 2 || r.brand_id === a[1]));
      for (const r of hit) { r.status = "error"; r.error = "중단됨(응답 없음) — 다시 실행할 수 있습니다"; }
      return hit.map((r) => ({ id: r.id }));
    }
    if (sql.includes("UPDATE pm_runs SET status='ok'")) {
      const r = db.runs.find((x) => x.id === a[0]);
      if (r) { r.status = "ok"; r.mode = String(a[1]); r.summary = String(a[2]); r.created_count = Number(a[3]); r.skipped_count = Number(a[4]); }
      return [];
    }
    if (sql.includes("UPDATE pm_runs SET status='error', error=$2")) {
      const r = db.runs.find((x) => x.id === a[0]);
      if (r) { r.status = "error"; r.error = String(a[1]); }
      return [];
    }
    if (sql.includes("FROM pm_runs WHERE brand_id=")) {
      return db.runs.filter((r) => r.brand_id === a[0]).slice(0, Number(a[1] ?? 10))
        .map((r) => ({ id: r.id, mode: r.mode, status: r.status, summary: r.summary, error: r.error,
          started_at: new Date(r.started_at).toISOString(), finished_at: null, triggered_by: r.triggered_by }));
    }

    // pm_brand_config
    if (sql.includes("INSERT INTO pm_brand_config")) {
      const id = String(a[0]);
      let c = db.config.find((x) => x.brand_id === id);
      if (!c) {
        c = { brand_id: id, enabled: false, owner_admin_id: null, last_run_at: null, last_run_mode: null, last_status: null, last_error: null, last_summary: "", next_action: "", note: "" };
        db.config.push(c);
      }
      if (sql.includes("last_run_at")) {
        c.last_run_at = db.now;
        c.last_run_mode = String(a[1]);
        if (sql.includes("'ok'")) { c.last_status = "ok"; c.last_error = null; c.last_summary = String(a[2] ?? ""); c.next_action = String(a[3] ?? ""); }
        else { c.last_status = "error"; c.last_error = String(a[2] ?? ""); }
      } else if (sql.includes("enabled")) c.enabled = Boolean(a[1]);
      else if (sql.includes("owner_admin_id")) c.owner_admin_id = (a[1] as string | null) ?? null;
      else if (sql.includes("note")) c.note = String(a[1] ?? "");
      return [];
    }
    if (sql.includes("FROM pm_brand_config WHERE brand_id=")) {
      const c = db.config.find((x) => x.brand_id === a[0]);
      return c ? [{ ...c, last_run_at: c.last_run_at ? new Date(c.last_run_at).toISOString() : null }] : [];
    }
    if (sql.includes("FROM pm_brand_config p")) {
      const eligible = db.config.filter((c) => c.enabled)
        .filter((c) => { const b = db.brands.find((x) => x.id === c.brand_id); return b && !b.is_test && !["dropped", "churned"].includes(b.state); })
        .sort((x, y) => (x.last_run_at ?? 0) - (y.last_run_at ?? 0) || x.brand_id.localeCompare(y.brand_id));
      if (sql.includes("count(*)")) return [{ n: String(eligible.length) }];
      return eligible.slice(0, Number(a[0])).map((c) => ({ brand_id: c.brand_id }));
    }

    // pm_kpis
    if (sql.includes("FROM pm_kpis WHERE brand_id=")) {
      return db.kpis.filter((k) => k.brand_id === a[0] && k.status === "active").map((k) => ({
        ...k, target_value: k.target_value == null ? null : String(k.target_value),
        current_value: k.current_value == null ? null : String(k.current_value),
      }));
    }
    if (sql.includes("INSERT INTO pm_kpis")) {
      const row = { id: `k${++db.seq}`, brand_id: String(a[0]), name: String(a[1]), unit: String(a[2] ?? ""),
        target_value: a[3] as number | null, current_value: a[4] as number | null, measured_at: (a[5] as string | null) ?? null,
        direction: String(a[6]), period_start: (a[7] as string | null) ?? null, period_end: (a[8] as string | null) ?? null,
        owner_admin_id: (a[9] as string | null) ?? null, evidence: String(a[10] ?? ""), source: "manual", source_ref: "", status: "active" };
      db.kpis.push(row);
      return [{ id: row.id }];
    }

    // pm_tasks
    if (sql.includes("INSERT INTO pm_tasks")) {
      const isSuggestion = sql.includes("dedupe_key");
      const dedupe = isSuggestion ? String(a[9]) : null;
      if (dedupe && db.tasks.some((t) => t.brand_id === a[0] && t.dedupe_key === dedupe)) return [];
      const row: TaskRow = {
        id: `t${++db.seq}`, brand_id: String(a[0]), kind: String(a[1]), title: String(a[2]),
        detail: String(a[3] ?? ""), priority: Number(a[4]),
        owner_admin_id: isSuggestion ? null : ((a[5] as string | null) ?? null),
        due_date: isSuggestion ? null : ((a[6] as string | null) ?? null),
        status: "open", origin: isSuggestion ? String(a[5]) : "human",
        confirmed_by: isSuggestion ? null : String(a[7] ?? ""),
        dedupe_key: dedupe, edited_by_human: false,
        evidence_kind: String(isSuggestion ? a[6] : a[8] ?? ""), evidence_id: String(isSuggestion ? a[7] : a[9] ?? ""),
        evidence_url: isSuggestion ? "" : String(a[10] ?? ""), evidence_label: String(isSuggestion ? a[8] : a[11] ?? ""),
        created_by: String(a[isSuggestion ? 10 : 7] ?? ""), created_at: new Date(db.now).toISOString(),
        updated_at: new Date(db.now).toISOString(),
      };
      db.tasks.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("FROM pm_tasks t WHERE t.brand_id=")) {
      const openOnly = sql.includes("t.status = ANY($2::text[])");
      const doneOnly = sql.includes("t.status IN ('done','dismissed')");
      return db.tasks.filter((t) => t.brand_id === a[0]
        && (openOnly ? ["open", "doing", "reopened"].includes(t.status) : doneOnly ? ["done", "dismissed"].includes(t.status) : true))
        .map((t) => ({ ...t }));
    }
    if (sql.includes("SELECT status FROM pm_tasks WHERE id=$1 AND brand_id=$2")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return t ? [{ status: t.status }] : [];
    }
    if (sql.includes("SELECT title, priority, owner_admin_id, due_date")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      return t ? [{ title: t.title, priority: t.priority, owner_admin_id: t.owner_admin_id, due_date: t.due_date }] : [];
    }
    if (sql.includes("UPDATE pm_tasks SET status=$3")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (t) { t.status = String(a[2]); t.edited_by_human = true; t.confirmed_by = t.confirmed_by ?? String(a[3]); }
      return [];
    }
    if (sql.includes("UPDATE pm_tasks SET confirmed_by=$3")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (!t) return [];
      t.confirmed_by = String(a[2]); t.edited_by_human = true;
      return [{ id: t.id }];
    }
    if (sql.includes("UPDATE pm_tasks SET kind=$3")) {
      const t = db.tasks.find((x) => x.id === a[0] && x.brand_id === a[1]);
      if (t) { t.kind = String(a[2]); t.title = String(a[3]); t.detail = String(a[4]); t.priority = Number(a[5]);
        t.owner_admin_id = (a[6] as string | null) ?? null; t.due_date = (a[7] as string | null) ?? null; t.edited_by_human = true; }
      return [];
    }
    if (sql.includes("INSERT INTO pm_task_events")) {
      if (db.failEventInsert) throw new Error("이력 기록 실패(모의)");
      db.events.push({ task_id: String(a[0]), brand_id: String(a[1]), field: String(a[2]), old_value: String(a[3] ?? ""), new_value: String(a[4] ?? ""), actor: String(a[5] ?? "") });
      return [];
    }
    if (sql.includes("FROM pm_task_events")) {
      return db.events.filter((e) => e.task_id === a[0] && e.brand_id === a[1])
        .map((e) => ({ field: e.field, old_value: e.old_value, new_value: e.new_value, actor: e.actor, at: new Date(db.now).toISOString() }));
    }
    return [];
  };
  const client = { query: async (sql: string, args: unknown[] = []) => { const rows = await run(sql, args); return { rows, rowCount: rows.length }; } };
  return {
    query: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    getPool: () => ({ connect: async () => ({ release: () => {} }) }),
    tx: async <T,>(fn: (c: typeof client) => Promise<T>): Promise<T> => {
      const snap = {
        tasks: JSON.parse(JSON.stringify(db.tasks)), events: JSON.parse(JSON.stringify(db.events)),
        runs: JSON.parse(JSON.stringify(db.runs)), config: JSON.parse(JSON.stringify(db.config)),
      };
      try { return await fn(client); }
      catch (e) { db.tasks = snap.tasks; db.events = snap.events; db.runs = snap.runs; db.config = snap.config; throw e; }
    },
  };
});

// 대화 조회는 별도 테스트가 있으므로 여기서는 고정값.
const comms = { errors: [] as string[], total: 4 };
vi.mock("../lib/pm-comms", () => ({
  brandCommTimeline: async () => ({
    items: [{ id: "email-1", channelLabel: "이메일", occurredAt: "2026-09-26T01:00:00Z", title: "재고 문의", bodyFull: "재고가 부족합니다." }],
    channels: [
      { channel: "email", label: "이메일", query: comms.errors.includes("이메일") ? "error" : "ok", queryNote: "", ingest: "configured", ingestNote: "", count: 4, latestAt: null },
      { channel: "slack", label: "Slack", query: "absent", queryNote: "", ingest: "none", ingestNote: "", count: null, latestAt: null },
    ],
    total: comms.total, page: 1, pageSize: 1, pageCount: 1,
    partial: comms.errors.length > 0, ingestUnknown: false, rangeNote: "",
  }),
  PM_COMMS_PAGE_SIZE: 25,
}));

// AI 단계는 시나리오별로 갈아끼운다.
const ai = { ok: false, note: "AI 키(ANTHROPIC_API_KEY)가 없습니다 — 규칙 기반으로만 점검했습니다.", suggestions: [] as unknown[] };
vi.mock("../lib/pm-ai", () => ({
  buildEvidence: (items: { id: string }[]) => items.map((it, i) => ({ ref: `e${i + 1}`, sourceId: it.id, channel: "이메일", at: "2026-09-26 01:00", title: "재고 문의", body: "재고가 부족합니다." })),
  aiSuggestions: async () => ({ ok: ai.ok, suggestions: ai.suggestions, rejected: 0, note: ai.note }),
  AI_MAX_EVIDENCE: 12, AI_BODY_CHARS: 1500, AI_TOTAL_CHARS: 20000, AI_MAX_SUGGESTIONS: 8,
}));

import {
  runPmAnalysis, listPmTasks, setPmTaskStatus, updatePmTask, confirmPmTask, listTaskEvents,
  getPmConfig, setPmEnabled, runPmBatch, releaseStalePmRuns, listPmKpis, createPmKpi,
  PM_RUN_STALE_MIN,
} from "../lib/pm-agent";

const ACTOR = "pm@dinostudio.kr";

beforeEach(() => {
  db.now = Date.UTC(2026, 8, 27, 3, 0, 0);
  db.brands = [
    { id: B, brand_name: "예시브랜드", state: "onboarding", last_contact_at: "2026-08-01T00:00:00Z", is_test: false },
    { id: TEST_B, brand_name: "[PM검수] 샘플브랜드", state: "dropped", last_contact_at: null, is_test: true },
  ];
  db.tasks = []; db.events = []; db.runs = []; db.config = []; db.kpis = [];
  db.failEventInsert = false; db.failFactsFor = null; db.seq = 0;
  comms.errors = []; comms.total = 4;
  ai.ok = false; ai.suggestions = []; ai.note = "AI 키(ANTHROPIC_API_KEY)가 없습니다 — 규칙 기반으로만 점검했습니다.";
});

describe("분석 실행 — AI 표시가 실제 동작과 일치한다", () => {
  it("AI 를 못 쓰면 mode='rules' 이고 사유를 알린다(허위 AI 표시 없음)", async () => {
    const r = await runPmAnalysis(B);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("rules");
    expect(r.aiNote).toContain("AI 키");
    expect(r.summary).toContain("규칙 점검만");
    expect(db.tasks.every((t) => t.origin === "rules")).toBe(true);
    expect((await getPmConfig(B)).lastRunMode).toBe("rules");
  });

  it("AI 가 실제로 성공하면 mode='ai' 이고 AI 제안은 origin='ai' 로 저장된다", async () => {
    ai.ok = true;
    ai.note = "AI 가 대화 1건을 읽어 1건 제안";
    ai.suggestions = [{
      kind: "issue", title: "재고 부족 확인 필요", detail: "— 근거: 이메일", priority: 1,
      dedupeKey: "ai:email-1:issue", evidenceKind: "comm", evidenceId: "email-1", evidenceLabel: "이메일 · 2026-09-26",
    }];
    const r = await runPmAnalysis(B);
    expect(r.mode).toBe("ai");
    expect(r.summary).toContain("AI(대화 본문) + 규칙 점검");
    const aiTask = db.tasks.find((t) => t.origin === "ai");
    expect(aiTask).toBeTruthy();
    expect(aiTask!.title).toBe("재고 부족 확인 필요");
    expect(db.tasks.some((t) => t.origin === "rules")).toBe(true);   // 규칙 제안도 함께
  });

  it("AI 호출이 실패하면 규칙 결과만 남고 mode='rules' 로 정확히 적는다", async () => {
    ai.ok = false;
    ai.note = "AI 호출 실패 — timeout · 규칙 기반 결과만 저장했습니다.";
    const r = await runPmAnalysis(B);
    expect(r.mode).toBe("rules");
    expect(r.aiNote).toContain("AI 호출 실패");
    expect(db.tasks.some((t) => t.origin === "ai")).toBe(false);
  });

  it("규칙 점검만 요청하면 AI 를 쓰지 않는다", async () => {
    ai.ok = true;
    ai.suggestions = [{ kind: "todo", title: "AI 제안", detail: "", priority: 2, dedupeKey: "ai:x:todo", evidenceKind: "comm", evidenceId: "x", evidenceLabel: "" }];
    const r = await runPmAnalysis(B, { useAi: false });
    expect(r.mode).toBe("rules");
    expect(db.tasks.some((t) => t.origin === "ai")).toBe(false);
  });

  it("대화 조회 실패는 제안과 요약에 사실로 드러난다", async () => {
    comms.errors = ["이메일"];
    const r = await runPmAnalysis(B);
    expect(r.summary).toContain("대화 확인 실패");
    expect(db.tasks.some((t) => t.title.includes("대화 수집 확인 실패"))).toBe(true);
  });
});

describe("반복 실행 — 중복 없고 사람 작업을 덮지 않는다", () => {
  it("두 번 돌려도 같은 제안이 늘지 않는다", async () => {
    const first = await runPmAnalysis(B);
    const n = db.tasks.length;
    expect(first.created).toBe(n);
    const second = await runPmAnalysis(B);
    expect(db.tasks.length).toBe(n);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(n);
  });

  it("사람이 완료한 제안을 다시 열지 않는다", async () => {
    await runPmAnalysis(B);
    const t = db.tasks[0];
    await setPmTaskStatus(t.id, B, "done", ACTOR);
    await runPmAnalysis(B);
    expect(db.tasks.find((x) => x.id === t.id)!.status).toBe("done");
    expect(db.tasks.filter((x) => x.dedupe_key === t.dedupe_key)).toHaveLength(1);
  });

  it("사람이 고친 제목·담당·마감을 다시 덮지 않는다", async () => {
    await runPmAnalysis(B);
    const t = db.tasks[0];
    await updatePmTask(t.id, B, { kind: "todo", title: "사람이 고친 제목", detail: "", priority: 1, owner: ACTOR, dueDate: "2026-10-10" }, ACTOR);
    await runPmAnalysis(B);
    const after = db.tasks.find((x) => x.id === t.id)!;
    expect(after.title).toBe("사람이 고친 제목");
    expect(after.owner_admin_id).toBe(ACTOR);
    expect(after.due_date).toBe("2026-10-10");
    expect(after.edited_by_human).toBe(true);
  });
});

describe("제안과 사람이 확정한 업무를 구분한다", () => {
  it("제안은 확정 전까지 confirmed_by 가 비어 있다", async () => {
    await runPmAnalysis(B);
    const t = db.tasks[0];
    expect(t.origin).toBe("rules");
    expect(t.confirmed_by).toBeNull();
    await confirmPmTask(t.id, B, ACTOR);
    const after = db.tasks.find((x) => x.id === t.id)!;
    expect(after.confirmed_by).toBe(ACTOR);
    expect(after.origin).toBe("rules");     // 출처는 그대로 남는다
    expect(db.events.some((e) => e.field === "confirmed")).toBe(true);
  });

  it("다른 브랜드의 업무 id 로는 확정할 수 없다", async () => {
    await runPmAnalysis(B);
    await expect(confirmPmTask(db.tasks[0].id, TEST_B, ACTOR)).rejects.toThrow(/이 브랜드의 업무가 아닙니다/);
  });

  it("다른 브랜드의 업무 id 로는 수정할 수 없다", async () => {
    await runPmAnalysis(B);
    await expect(updatePmTask(db.tasks[0].id, TEST_B, { title: "탈취" }, ACTOR)).rejects.toThrow(/이 브랜드의 업무가 아닙니다/);
  });
});

describe("상태 변경과 이력은 한 트랜잭션", () => {
  it("상태를 바꾸면 이력이 함께 남는다", async () => {
    await runPmAnalysis(B);
    const t = db.tasks[0];
    await setPmTaskStatus(t.id, B, "doing", ACTOR);
    const ev = await listTaskEvents(t.id, B);
    expect(ev.some((e) => e.field === "status" && e.newValue === "doing")).toBe(true);
  });

  it("이력 기록이 실패하면 상태 변경도 되돌아간다", async () => {
    await runPmAnalysis(B);
    const t = db.tasks[0];
    const before = t.status;
    db.failEventInsert = true;
    await expect(setPmTaskStatus(t.id, B, "done", ACTOR)).rejects.toThrow();
    expect(db.tasks.find((x) => x.id === t.id)!.status).toBe(before);
    expect(db.events).toHaveLength(0);
  });
});

describe("동시 실행 보호와 중단 복구", () => {
  it("실행 중이면 새 분석을 시작하지 않는다", async () => {
    db.runs.push({ id: "runX", brand_id: B, mode: "rules", status: "running", summary: "", error: null, started_at: db.now, triggered_by: "manual", created_count: 0, skipped_count: 0 });
    const r = await runPmAnalysis(B);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("이미 분석이 실행 중");
  });

  it("중단된 실행은 일정 시간 뒤 풀리고 다시 돌 수 있다", async () => {
    db.runs.push({ id: "runX", brand_id: B, mode: "rules", status: "running", summary: "", error: null, started_at: db.now, triggered_by: "manual", created_count: 0, skipped_count: 0 });
    db.now += (PM_RUN_STALE_MIN + 1) * 60_000;
    const released = await releaseStalePmRuns(B);
    expect(released).toBe(1);
    expect(db.runs[0].error).toContain("중단됨");
    const r = await runPmAnalysis(B);
    expect(r.ok).toBe(true);
  });

  it("분석이 실패하면 오류를 설정에 남긴다(성공으로 숨기지 않는다)", async () => {
    db.brands = [];       // 브랜드 조회 실패 유도
    const r = await runPmAnalysis(B);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("분석 실패");
    expect((await getPmConfig(B)).lastStatus).toBe("error");
  });
});

describe("자동 운영 batch", () => {
  it("PM 을 켠 브랜드만 돈다", async () => {
    const r0 = await runPmBatch(5);
    expect(r0.picked).toBe(0);
    await setPmEnabled(B, true);
    const r1 = await runPmBatch(5);
    expect(r1.picked).toBe(1);
    expect(r1.ok).toBe(1);
  });

  it("테스트 브랜드는 자동 운영에서 제외한다", async () => {
    await setPmEnabled(TEST_B, true);
    const r = await runPmBatch(5);
    expect(r.picked).toBe(0);
  });

  it("시간 예산을 넘기면 멈추고 남은 수를 알린다", async () => {
    await setPmEnabled(B, true);
    const r = await runPmBatch(5, -1);
    expect(r.stoppedForTime).toBe(true);
    expect(r.picked).toBe(0);
    expect(r.eligible).toBe(1);
    expect(r.remaining).toBe(1);
  });

  it("오래 안 돈 브랜드부터 공정하게 순환한다 — 굶는 브랜드가 없다", async () => {
    const C = "33333333-3333-4333-8333-333333333333";
    db.brands.push({ id: C, brand_name: "두번째", state: "setup", last_contact_at: "2026-08-01T00:00:00Z", is_test: false });
    await setPmEnabled(B, true);
    await setPmEnabled(C, true);

    // 한 번에 1건만 처리 — 첫 회차는 둘 중 하나, 두 번째 회차는 나머지가 처리돼야 한다.
    const r1 = await runPmBatch(1);
    expect(r1.eligible).toBe(2);
    expect(r1.picked).toBe(1);
    expect(r1.remaining).toBe(1);
    const firstRan = db.config.filter((c) => c.last_run_at != null).map((c) => c.brand_id);
    expect(firstRan).toHaveLength(1);

    db.now += 60_000;
    const r2 = await runPmBatch(1);
    expect(r2.picked).toBe(1);
    const ranNow = db.config.filter((c) => c.last_run_at != null).map((c) => c.brand_id).sort();
    expect(ranNow).toEqual([B, C].sort());          // 두 브랜드 모두 한 번씩 돌았다

    // 세 번째 회차는 다시 가장 오래된 쪽(첫 회차 브랜드)으로 돌아온다.
    db.now += 60_000;
    await runPmBatch(1);
    const last = db.config.find((c) => c.brand_id === firstRan[0])!;
    expect(last.last_run_at).toBe(db.now);
  });

  it("실패해도 last_run_at 이 갱신돼 뒤 브랜드를 막지 않는다", async () => {
    const C = "33333333-3333-4333-8333-333333333333";
    db.brands.push({ id: C, brand_name: "두번째", state: "setup", last_contact_at: null, is_test: false });
    await setPmEnabled(B, true);
    await setPmEnabled(C, true);
    db.failFactsFor = B;                               // B 만 분석 실패
    await runPmBatch(1);
    db.failFactsFor = null;
    expect(db.config.find((c) => c.brand_id === B)!.last_status).toBe("error");
    expect(db.config.find((c) => c.brand_id === B)!.last_run_at).not.toBeNull();
    db.now += 60_000;
    const r2 = await runPmBatch(1);
    expect(r2.picked).toBe(1);
    expect(db.config.find((c) => c.brand_id === C)!.last_run_at).not.toBeNull();   // C 도 돌았다
  });
});

describe("KPI — 값 없음과 0 을 구분해 저장한다", () => {
  it("빈 값은 null, 0 은 0 으로 남는다", async () => {
    await createPmKpi(B, { name: "값없음", target: null, current: null }, ACTOR);
    await createPmKpi(B, { name: "영", target: 100, current: 0, measuredAt: "2026-09-27" }, ACTOR);
    const list = await listPmKpis(B, "2026-09-27");
    const none = list.find((k) => k.name === "값없음")!;
    const zero = list.find((k) => k.name === "영")!;
    expect(none.target).toBeNull();
    expect(none.progress).toBeNull();
    expect(none.risk).toBe("unknown");
    expect(zero.current).toBe(0);
    expect(zero.progress).toBe(0);
    expect(zero.risk).toBe("at_risk");
  });
});

describe("자동 운영 스케줄 등록", () => {
  it("vercel.json 에 PM 전용 cron 이 매시간으로 등록돼 있다", async () => {
    const { readFileSync } = await import("node:fs");
    const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as
      { crons: { path: string; schedule: string }[] };
    const pm = cfg.crons.find((c) => c.path.startsWith("/api/cron/pm-agent"));
    expect(pm).toBeTruthy();
    // 매시 1회 — 분은 고정, 시간은 매시(정시에 몰린 기존 작업과 겹치지 않게 비켜 둔다).
    expect(pm!.schedule).toMatch(/^\d+ \* \* \* \*$/);
    expect(pm!.schedule.startsWith("0 ")).toBe(false);
    expect(pm!.path).toContain("limit=");
    // 기존 cron 을 지우지 않았다.
    for (const p of ["/api/cron/lead-sequence", "/api/cron/zoom-ingest", "/api/cron/bulk-send"]) {
      expect(cfg.crons.some((c) => c.path.startsWith(p)), p).toBe(true);
    }
  });
});
