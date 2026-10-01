// 브랜드별 PM 에이전트 — 설정·KPI·업무·분석 실행.
//   원칙:
//     · DB 오류를 빈 값이나 성공으로 숨기지 않는다.
//     · AI 키가 없으면 규칙 기반으로만 돌고, 결과를 'rules' 로 표시한다(AI라고 적지 않는다).
//     · 제안(origin='rules'|'ai')과 사람이 확정한 업무(origin='human' 또는 confirmed_by 있음)를 구분한다.
//     · 반복 실행이 사람이 손댄 업무·완료 업무를 덮어쓰지 않는다.
//     · 외부 발송은 전혀 하지 않는다.
import { query, queryOne, tx } from "./db";
import {
  rulesSuggestions, nextActionLine, kpiProgress, kpiRisk,
  type PmFacts, type PmSuggestion, type KpiRisk,
} from "./pm-analyze";

export const PM_SCHEMA_TABLES = [
  "pm_brand_config", "pm_kpis", "pm_tasks", "pm_task_events", "pm_manual_comms", "pm_runs",
] as const;
export const PM_SCHEMA_MIGRATION = "0099_pm_agent.sql";

export interface PmSchemaState { ready: boolean; missing: string[]; error?: string }

/** 0099 적용 여부를 실제 스키마에서 확인한다 — "적용됐다고 가정"하지 않는다. */
export async function pmSchemaState(): Promise<PmSchemaState> {
  try {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`, [[...PM_SCHEMA_TABLES]]);
    const have = new Set(rows.map((r) => r.table_name));
    const missing = PM_SCHEMA_TABLES.filter((t) => !have.has(t));
    return { ready: missing.length === 0, missing };
  } catch (e) {
    return { ready: false, missing: [], error: (e as Error).message.slice(0, 200) };
  }
}

// ── 설정 ─────────────────────────────────────────────────────
export interface PmConfig {
  brandId: string;
  enabled: boolean;
  ownerAdminId: string | null;
  lastRunAt: string | null;
  lastRunMode: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSummary: string;
  nextAction: string;
  note: string;
}

const EMPTY_CONFIG = (brandId: string): PmConfig => ({
  brandId, enabled: false, ownerAdminId: null, lastRunAt: null, lastRunMode: null,
  lastStatus: null, lastError: null, lastSummary: "", nextAction: "", note: "",
});

export async function getPmConfig(brandId: string): Promise<PmConfig> {
  const r = await queryOne<{
    brand_id: string; enabled: boolean; owner_admin_id: string | null;
    last_run_at: string | null; last_run_mode: string | null; last_status: string | null;
    last_error: string | null; last_summary: string; next_action: string; note: string;
  }>(
    `SELECT brand_id, enabled, owner_admin_id, last_run_at::text AS last_run_at, last_run_mode,
            last_status, last_error, last_summary, next_action, note
       FROM pm_brand_config WHERE brand_id=$1`, [brandId]);
  if (!r) return EMPTY_CONFIG(brandId);
  return {
    brandId: r.brand_id, enabled: r.enabled, ownerAdminId: r.owner_admin_id,
    lastRunAt: r.last_run_at, lastRunMode: r.last_run_mode, lastStatus: r.last_status,
    lastError: r.last_error, lastSummary: r.last_summary, nextAction: r.next_action, note: r.note,
  };
}

export async function setPmEnabled(brandId: string, enabled: boolean): Promise<void> {
  await query(
    `INSERT INTO pm_brand_config (brand_id, enabled) VALUES ($1,$2)
     ON CONFLICT (brand_id) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=now()`,
    [brandId, enabled]);
}

export async function setPmOwner(brandId: string, ownerAdminId: string | null): Promise<void> {
  await query(
    `INSERT INTO pm_brand_config (brand_id, owner_admin_id) VALUES ($1,$2)
     ON CONFLICT (brand_id) DO UPDATE SET owner_admin_id=EXCLUDED.owner_admin_id, updated_at=now()`,
    [brandId, ownerAdminId]);
}

export async function setPmNote(brandId: string, note: string): Promise<void> {
  await query(
    `INSERT INTO pm_brand_config (brand_id, note) VALUES ($1,$2)
     ON CONFLICT (brand_id) DO UPDATE SET note=EXCLUDED.note, updated_at=now()`,
    [brandId, note.slice(0, 2000)]);
}

// ── KPI ──────────────────────────────────────────────────────
export interface PmKpi {
  id: string; name: string; unit: string;
  target: number | null; current: number | null; measuredAt: string | null;
  direction: "up" | "down";
  periodStart: string | null; periodEnd: string | null;
  owner: string | null; evidence: string; source: string; sourceRef: string;
  status: string;
  /** 계산값 — 값 없음은 null 이다(0% 로 적지 않는다). */
  progress: number | null;
  risk: KpiRisk;
  daysLeft: number | null;
}

export interface KpiInput {
  name: string; unit?: string;
  target?: number | null; current?: number | null; measuredAt?: string | null;
  direction?: "up" | "down";
  periodStart?: string | null; periodEnd?: string | null;
  owner?: string | null; evidence?: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;   // 값 없음 — 0 과 구분한다
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const day = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export async function listPmKpis(brandId: string, today = kstToday()): Promise<PmKpi[]> {
  const rows = await query<{
    id: string; name: string; unit: string; target_value: string | null; current_value: string | null;
    measured_at: string | null; direction: string; period_start: string | null; period_end: string | null;
    owner_admin_id: string | null; evidence: string; source: string; source_ref: string; status: string;
  }>(
    `SELECT id, name, unit, target_value::text AS target_value, current_value::text AS current_value,
            measured_at::text AS measured_at, direction, period_start::text AS period_start,
            period_end::text AS period_end, owner_admin_id, evidence, source, source_ref, status
       FROM pm_kpis WHERE brand_id=$1 AND status='active'
      ORDER BY COALESCE(period_end, '9999-12-31') ASC, name ASC`, [brandId]);

  return rows.map((r) => {
    const target = r.target_value == null ? null : Number(r.target_value);
    const current = r.current_value == null ? null : Number(r.current_value);
    const direction = r.direction === "down" ? "down" : "up";
    const base = { target, current, direction: direction as "up" | "down" };
    return {
      id: r.id, name: r.name, unit: r.unit, target, current, measuredAt: r.measured_at,
      direction: direction as "up" | "down",
      periodStart: r.period_start, periodEnd: r.period_end,
      owner: r.owner_admin_id, evidence: r.evidence, source: r.source, sourceRef: r.source_ref,
      status: r.status,
      progress: kpiProgress(base),
      risk: kpiRisk({ ...base, measuredAt: r.measured_at, periodEnd: r.period_end, today }),
      daysLeft: r.period_end ? -Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.period_end}T00:00:00Z`)) / 86400_000) : null,
    };
  });
}

export async function createPmKpi(brandId: string, input: KpiInput, actor: string): Promise<string> {
  const r = await queryOne<{ id: string }>(
    `INSERT INTO pm_kpis (brand_id, name, unit, target_value, current_value, measured_at,
        direction, period_start, period_end, owner_admin_id, evidence, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual',$12) RETURNING id`,
    [brandId, input.name.trim().slice(0, 200), (input.unit ?? "").trim().slice(0, 40),
     num(input.target), num(input.current), day(input.measuredAt),
     input.direction === "down" ? "down" : "up",
     day(input.periodStart), day(input.periodEnd),
     (input.owner ?? "").trim().toLowerCase() || null, (input.evidence ?? "").slice(0, 2000), actor]);
  if (!r) throw new Error("KPI 저장 실패");
  return r.id;
}

export async function updatePmKpi(kpiId: string, brandId: string, input: KpiInput): Promise<void> {
  // id 와 brand_id 를 함께 조건에 둔다 — 다른 브랜드 id 가 섞여 들어와도 바뀌지 않는다.
  await query(
    `UPDATE pm_kpis SET name=$3, unit=$4, target_value=$5, current_value=$6, measured_at=$7,
        direction=$8, period_start=$9, period_end=$10, owner_admin_id=$11, evidence=$12, updated_at=now()
      WHERE id=$1 AND brand_id=$2`,
    [kpiId, brandId, input.name.trim().slice(0, 200), (input.unit ?? "").trim().slice(0, 40),
     num(input.target), num(input.current), day(input.measuredAt),
     input.direction === "down" ? "down" : "up",
     day(input.periodStart), day(input.periodEnd),
     (input.owner ?? "").trim().toLowerCase() || null, (input.evidence ?? "").slice(0, 2000)]);
}

export async function archivePmKpi(kpiId: string, brandId: string): Promise<void> {
  await query("UPDATE pm_kpis SET status='archived', updated_at=now() WHERE id=$1 AND brand_id=$2", [kpiId, brandId]);
}

/**
 * 계약·제안에서 읽은 "참고" 목표 — 합의 KPI 로 자동 확정하지 않는다.
 *   화면에는 출처와 함께 참고로만 보여주고, 사람이 눌러야 KPI 가 된다.
 */
export interface KpiReference {
  label: string; value: string; sourceLabel: string; sourceKind: "contract" | "proposal"; sourceId: string;
}
export async function kpiReferences(brandId: string): Promise<{ refs: KpiReference[]; error?: string }> {
  const refs: KpiReference[] = [];
  try {
    const cs = await query<{ id: string; kind: string; status: string; terms: Record<string, unknown> | null; start_date: string | null; end_date: string | null }>(
      `SELECT id, kind, status, terms, start_date::text AS start_date, end_date::text AS end_date
         FROM contracts WHERE brand_id=$1 AND status IN ('sent','signed') ORDER BY created_at DESC LIMIT 10`, [brandId]);
    for (const c of cs) {
      const t = c.terms ?? {};
      for (const [k, v] of Object.entries(t)) {
        if (v == null || typeof v === "object") continue;
        refs.push({
          label: k, value: String(v),
          sourceLabel: `계약 ${c.kind} (${c.status})${c.end_date ? ` · 종료 ${c.end_date}` : ""}`,
          sourceKind: "contract", sourceId: c.id,
        });
      }
    }
    const ps = await query<{ id: string; title: string; amount: number | null; status: string }>(
      `SELECT id, title, amount, status FROM proposals WHERE brand_id=$1 ORDER BY created_at DESC LIMIT 10`, [brandId]);
    for (const p of ps) {
      if (p.amount == null) continue;
      refs.push({
        label: "제안 금액", value: String(p.amount),
        sourceLabel: `제안 "${p.title}" (${p.status})`, sourceKind: "proposal", sourceId: p.id,
      });
    }
    return { refs: refs.slice(0, 40) };
  } catch (e) {
    return { refs, error: `참고 목표 조회 실패 — ${(e as Error).message.slice(0, 140)}` };
  }
}

// ── 업무(문제/할일/질문) ──────────────────────────────────────
export interface PmTask {
  id: string; kind: "issue" | "todo" | "question"; title: string; detail: string;
  priority: number; owner: string | null; dueDate: string | null; status: string;
  origin: "human" | "rules" | "ai"; confirmedBy: string | null;
  evidenceKind: string; evidenceId: string; evidenceUrl: string; evidenceLabel: string;
  editedByHuman: boolean; createdBy: string | null; createdAt: string; updatedAt: string;
  /** 계산값 — 마감 지남 / 담당 미배정. */
  overdue: boolean; unassigned: boolean;
}

export const OPEN_STATUSES = ["open", "doing", "reopened"] as const;

export async function listPmTasks(brandId: string, opts: { status?: "open" | "done" | "all" } = {}, today = kstToday()): Promise<PmTask[]> {
  const want = opts.status ?? "open";
  const cond = want === "open" ? "AND t.status = ANY($2::text[])"
    : want === "done" ? "AND t.status IN ('done','dismissed')" : "";
  const args: unknown[] = [brandId];
  if (want === "open") args.push([...OPEN_STATUSES]);
  const rows = await query<{
    id: string; kind: string; title: string; detail: string; priority: number;
    owner_admin_id: string | null; due_date: string | null; status: string; origin: string;
    confirmed_by: string | null; evidence_kind: string; evidence_id: string; evidence_url: string;
    evidence_label: string; edited_by_human: boolean; created_by: string | null;
    created_at: string; updated_at: string;
  }>(
    `SELECT t.id, t.kind, t.title, t.detail, t.priority, t.owner_admin_id, t.due_date::text AS due_date,
            t.status, t.origin, t.confirmed_by, t.evidence_kind, t.evidence_id, t.evidence_url,
            t.evidence_label, t.edited_by_human, t.created_by,
            t.created_at::text AS created_at, t.updated_at::text AS updated_at
       FROM pm_tasks t WHERE t.brand_id=$1 ${cond}
      ORDER BY t.priority ASC, COALESCE(t.due_date, '9999-12-31') ASC, t.created_at DESC`, args);

  return rows.map((r) => ({
    id: r.id, kind: (r.kind as PmTask["kind"]), title: r.title, detail: r.detail,
    priority: r.priority, owner: r.owner_admin_id, dueDate: r.due_date, status: r.status,
    origin: (r.origin as PmTask["origin"]), confirmedBy: r.confirmed_by,
    evidenceKind: r.evidence_kind, evidenceId: r.evidence_id, evidenceUrl: r.evidence_url,
    evidenceLabel: r.evidence_label, editedByHuman: r.edited_by_human, createdBy: r.created_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
    overdue: Boolean(r.due_date) && (["open", "doing", "reopened"].includes(r.status)) && r.due_date! < today,
    unassigned: !r.owner_admin_id && ["open", "doing", "reopened"].includes(r.status),
  }));
}

export interface TaskInput {
  kind?: "issue" | "todo" | "question"; title: string; detail?: string;
  priority?: number; owner?: string | null; dueDate?: string | null;
  evidenceKind?: string; evidenceId?: string; evidenceUrl?: string; evidenceLabel?: string;
}

const prio = (v: unknown): number => {
  const n = Number(v);
  return n === 1 || n === 3 ? n : 2;
};

export async function createPmTask(brandId: string, input: TaskInput, actor: string): Promise<string> {
  const r = await queryOne<{ id: string }>(
    `INSERT INTO pm_tasks (brand_id, kind, title, detail, priority, owner_admin_id, due_date,
        origin, confirmed_by, confirmed_at, evidence_kind, evidence_id, evidence_url, evidence_label, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'human',$8,now(),$9,$10,$11,$12,$8) RETURNING id`,
    [brandId, input.kind ?? "todo", input.title.trim().slice(0, 300), (input.detail ?? "").slice(0, 4000),
     prio(input.priority), (input.owner ?? "").trim().toLowerCase() || null, day(input.dueDate),
     actor, (input.evidenceKind ?? "").slice(0, 40), (input.evidenceId ?? "").slice(0, 100),
     (input.evidenceUrl ?? "").slice(0, 600), (input.evidenceLabel ?? "").slice(0, 300)]);
  if (!r) throw new Error("업무 저장 실패");
  await logTaskEvent(r.id, brandId, "created", "", input.title.trim().slice(0, 300), actor);
  return r.id;
}

export async function updatePmTask(taskId: string, brandId: string, input: TaskInput, actor: string): Promise<void> {
  const before = await queryOne<{ title: string; priority: number; owner_admin_id: string | null; due_date: string | null }>(
    "SELECT title, priority, owner_admin_id, due_date::text AS due_date FROM pm_tasks WHERE id=$1 AND brand_id=$2",
    [taskId, brandId]);
  if (!before) throw new Error("이 브랜드의 업무가 아닙니다.");
  await query(
    `UPDATE pm_tasks SET kind=$3, title=$4, detail=$5, priority=$6, owner_admin_id=$7, due_date=$8,
        evidence_url=$9, edited_by_human=true, updated_at=now()
      WHERE id=$1 AND brand_id=$2`,
    [taskId, brandId, input.kind ?? "todo", input.title.trim().slice(0, 300), (input.detail ?? "").slice(0, 4000),
     prio(input.priority), (input.owner ?? "").trim().toLowerCase() || null, day(input.dueDate),
     (input.evidenceUrl ?? "").slice(0, 600)]);
  {
    if (before.title !== input.title.trim()) await logTaskEvent(taskId, brandId, "title", before.title, input.title.trim(), actor);
    const newOwner = (input.owner ?? "").trim().toLowerCase() || "";
    if ((before.owner_admin_id ?? "") !== newOwner) await logTaskEvent(taskId, brandId, "owner", before.owner_admin_id ?? "", newOwner, actor);
    if ((before.due_date ?? "") !== (day(input.dueDate) ?? "")) await logTaskEvent(taskId, brandId, "due_date", before.due_date ?? "", day(input.dueDate) ?? "", actor);
    if (before.priority !== prio(input.priority)) await logTaskEvent(taskId, brandId, "priority", String(before.priority), String(prio(input.priority)), actor);
  }
}

const VALID_STATUS = new Set(["open", "doing", "done", "reopened", "dismissed"]);

export async function setPmTaskStatus(taskId: string, brandId: string, status: string, actor: string): Promise<void> {
  if (!VALID_STATUS.has(status)) throw new Error("상태 값이 올바르지 않습니다.");
  // 상태 변경과 이력 기록은 한 트랜잭션에서 — 이력 없는 변경이 남지 않게.
  await tx(async (c) => {
    const before = await c.query<{ status: string }>(
      "SELECT status FROM pm_tasks WHERE id=$1 AND brand_id=$2", [taskId, brandId]);
    if (before.rows.length === 0) throw new Error("이 브랜드의 업무가 아닙니다.");
    await c.query(
      `UPDATE pm_tasks SET status=$3, edited_by_human=true, updated_at=now(),
          confirmed_by=COALESCE(confirmed_by,$4), confirmed_at=COALESCE(confirmed_at,now())
        WHERE id=$1 AND brand_id=$2`, [taskId, brandId, status, actor]);
    await c.query(
      `INSERT INTO pm_task_events (task_id, brand_id, field, old_value, new_value, actor)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [taskId, brandId, "status", before.rows[0].status, status, actor]);
  });
}

/** 제안을 사람이 확정 — origin 은 남기고 확정자를 기록한다(AI/규칙 제안과 구분 유지). */
export async function confirmPmTask(taskId: string, brandId: string, actor: string): Promise<void> {
  await tx(async (c) => {
    const r = await c.query<{ id: string }>(
      `UPDATE pm_tasks SET confirmed_by=$3, confirmed_at=now(), edited_by_human=true, updated_at=now()
        WHERE id=$1 AND brand_id=$2 RETURNING id`, [taskId, brandId, actor]);
    if (r.rows.length === 0) throw new Error("이 브랜드의 업무가 아닙니다.");
    await c.query(
      `INSERT INTO pm_task_events (task_id, brand_id, field, old_value, new_value, actor)
       VALUES ($1,$2,$3,$4,$5,$6)`, [taskId, brandId, "confirmed", "", actor, actor]);
  });
}

async function logTaskEvent(taskId: string, brandId: string, field: string, oldV: string, newV: string, actor: string): Promise<void> {
  await query(
    `INSERT INTO pm_task_events (task_id, brand_id, field, old_value, new_value, actor)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [taskId, brandId, field, oldV.slice(0, 300), newV.slice(0, 300), actor]);
}

export interface TaskEvent { field: string; oldValue: string; newValue: string; actor: string; at: string }
export async function listTaskEvents(taskId: string, brandId: string): Promise<TaskEvent[]> {
  const rows = await query<{ field: string; old_value: string; new_value: string; actor: string; at: string }>(
    `SELECT field, old_value, new_value, actor, at::text AS at FROM pm_task_events
      WHERE task_id=$1 AND brand_id=$2 ORDER BY at DESC LIMIT 100`, [taskId, brandId]);
  return rows.map((r) => ({ field: r.field, oldValue: r.old_value, newValue: r.new_value, actor: r.actor, at: r.at }));
}

// ── 수동 대화 등록 ────────────────────────────────────────────
export interface ManualCommInput {
  channel: string; occurredAt: string; author?: string;
  sourceLabel?: string; sourceUrl?: string; body?: string;
}
const VALID_CHANNELS = new Set(["slack", "kakao", "call", "sms", "offline", "other"]);

export async function addManualComm(brandId: string, input: ManualCommInput, actor: string): Promise<string> {
  if (!VALID_CHANNELS.has(input.channel)) throw new Error("채널 값이 올바르지 않습니다.");
  const at = new Date(input.occurredAt);
  if (Number.isNaN(at.getTime())) throw new Error("대화 시각을 입력하세요.");
  const url = (input.sourceUrl ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) throw new Error("원문 링크는 http(s):// 로 시작해야 합니다.");
  // 원문이 없으면 추적 근거가 되지 못한다 — 화면과 같은 규칙을 서버에서도 지킨다.
  if (!(input.body ?? "").trim()) throw new Error("대화 원문을 입력하세요.");
  const r = await queryOne<{ id: string }>(
    `INSERT INTO pm_manual_comms (brand_id, channel, occurred_at, author, source_label, source_url, body, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [brandId, input.channel, at.toISOString(), (input.author ?? "").slice(0, 200),
     (input.sourceLabel ?? "").slice(0, 300), url.slice(0, 600), (input.body ?? "").slice(0, 20000), actor]);
  if (!r) throw new Error("대화 저장 실패");
  return r.id;
}

export async function deleteManualComm(commId: string, brandId: string): Promise<void> {
  await query("DELETE FROM pm_manual_comms WHERE id=$1 AND brand_id=$2", [commId, brandId]);
}

// ── 분석 실행 ─────────────────────────────────────────────────
export interface PmRunResult {
  ok: boolean;
  mode: "rules" | "ai";
  created: number;
  /** 이미 있던 제안을 최신 근거로 갱신한 수(사람이 손대지 않은 것만). */
  refreshed: number;
  skipped: number;
  summary: string;
  error?: string;
  /** AI 를 못 쓴 이유(있으면) — "AI 분석"이라고 적지 않기 위해 남긴다. */
  aiNote?: string;
}

/** 분석에 쓸 사실을 모은다. 조회 실패는 숨기지 않고 사실로 함께 올린다. */
export async function collectFacts(brandId: string, today = kstToday()): Promise<PmFacts> {
  const { brandCommTimeline } = await import("./pm-comms");
  const b = await queryOne<{ brand_name: string; state: string; last_contact_at: string | null }>(
    "SELECT brand_name, state, last_contact_at::text AS last_contact_at FROM brands WHERE id=$1", [brandId]);
  if (!b) throw new Error("브랜드를 찾을 수 없습니다.");

  const tl = await brandCommTimeline(brandId, { pageSize: 1, page: 1 });
  const kpis = await listPmKpis(brandId, today);
  const tasks = await listPmTasks(brandId, { status: "open" }, today);
  // 아직 열리지 않은 예약 회의를 "기록 없음" 문제로 만들면 안 된다 —
  //   실제로 지난(또는 종료 처리된) 회의만 대상으로 한다.
  const noTranscript = await query<{ id: string; topic: string | null }>(
    `SELECT id, COALESCE(topic,'') AS topic FROM meetings
      WHERE brand_id=$1
        AND (transcript IS NULL OR transcript='') AND (summary_md IS NULL OR summary_md='')
        AND status NOT IN ('scheduled','canceled')
        AND COALESCE(started_at, scheduled_at, created_at) < now() - interval '2 hours'
      ORDER BY COALESCE(started_at, created_at) DESC LIMIT 5`, [brandId]);

  // 채널을 통틀어 가장 최근 기록 한 건 — 그 시각이 실제 대화 시각인지 저장 시각인지도 함께 둔다.
  //   (사람이 붙여 넣은 전사는 "저장 시각" 이므로 실제 대화 시각이라고 말하지 않는다.)
  const latest = tl.channels
    .filter((c) => c.query === "ok" && c.latestAt)
    .sort((x, y) => new Date(y.latestAt!).getTime() - new Date(x.latestAt!).getTime())[0] ?? null;

  return {
    brandId, brandName: b.brand_name, state: b.state, today,
    lastContactAt: b.last_contact_at,
    lastRecordAt: latest?.latestAt ?? null,
    lastRecordKind: latest ? latest.latestKind : null,
    lastRecordChannel: latest?.label ?? null,
    channelErrors: tl.channels.filter((c) => c.query === "error").map((c) => c.label),
    channelsNotConnected: tl.channels.filter((c) => c.ingest === "none" || c.ingest === "off").map((c) => c.label),
    commCount: tl.total,
    kpis: kpis.map((k) => ({
      id: k.id, name: k.name, unit: k.unit, target: k.target, current: k.current,
      measuredAt: k.measuredAt, direction: k.direction, periodEnd: k.periodEnd, owner: k.owner,
    })),
    openTasks: tasks.map((t) => ({
      id: t.id, title: t.title, dueDate: t.dueDate, owner: t.owner, status: t.status,
      confirmed: t.origin === "human" || Boolean(t.confirmedBy),
    })),
    meetingsWithoutTranscript: noTranscript.map((m) => ({ id: m.id, topic: m.topic ?? "" })),
  };
}

/** 중단된 실행 회수 — 프로세스가 죽어 'running' 으로 남은 건을 일정 시간 뒤 풀어 준다. */
export const PM_RUN_STALE_MIN = 10;

export async function releaseStalePmRuns(brandId?: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE pm_runs SET status='error', finished_at=now(),
        error=COALESCE(NULLIF(error,''), '중단됨(응답 없음) — 다시 실행할 수 있습니다')
      WHERE status='running' AND started_at < now() - ($1 || ' minutes')::interval
        ${brandId ? "AND brand_id=$2" : ""}
      RETURNING id`,
    brandId ? [PM_RUN_STALE_MIN, brandId] : [PM_RUN_STALE_MIN]);
  return rows.length;
}

/**
 * 브랜드 1건 분석.
 *   · 동시 실행 보호: pm_runs 의 부분 유니크 인덱스(status='running').
 *     중단된 실행은 위 releaseStalePmRuns 로 풀린 뒤 재시도된다.
 *   · 규칙 점검은 항상 돌고(origin='rules'), AI 는 실제로 대화 본문을 읽었을 때만 origin='ai' 로 저장한다.
 *   · AI 호출이 없거나 실패하면 mode='rules' 로 정확히 기록한다(허위 AI 표시 금지).
 *   · 외부 발송은 하지 않는다.
 */
export async function runPmAnalysis(brandId: string, opts: { triggeredBy?: string; useAi?: boolean } = {}): Promise<PmRunResult> {
  await releaseStalePmRuns(brandId).catch(() => 0);

  let runId: string;
  try {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO pm_runs (brand_id, mode, triggered_by) VALUES ($1,'rules',$2) RETURNING id`,
      [brandId, opts.triggeredBy ?? "manual"]);
    if (!r) throw new Error("실행 기록 생성 실패");
    runId = r.id;
  } catch (e) {
    const msg = (e as Error).message;
    if (/pm_runs_one_running/.test(msg)) {
      return { ok: false, mode: "rules", created: 0, refreshed: 0, skipped: 0, summary: "", error: "이미 분석이 실행 중입니다 — 끝난 뒤 다시 시도해 주세요." };
    }
    return { ok: false, mode: "rules", created: 0, refreshed: 0, skipped: 0, summary: "", error: `분석을 시작하지 못했습니다 — ${msg.slice(0, 160)}` };
  }

  let mode: "rules" | "ai" = "rules";
  try {
    const facts = await collectFacts(brandId);
    const ruleList = rulesSuggestions(facts);

    // ── AI 단계: 실제로 대화 본문을 읽는다. 실패하면 규칙 결과만 남는다. ──
    let aiList: PmSuggestion[] = [];
    let aiNote: string | undefined;
    if (opts.useAi !== false) {
      const { brandCommTimeline } = await import("./pm-comms");
      const { buildEvidence, aiSuggestions } = await import("./pm-ai");
      const tl = await brandCommTimeline(brandId, { page: 1, pageSize: 12 });
      const evidence = buildEvidence(tl.items);
      const out = await aiSuggestions({ brandName: facts.brandName, evidence });
      aiNote = out.note;
      if (out.ok) { mode = "ai"; aiList = out.suggestions; }
    } else {
      aiNote = "규칙 기반 점검만 실행했습니다(AI 미사용).";
    }

    // 제안 저장 + 실행 기록 + 설정 갱신을 한 트랜잭션으로.
    const res = await tx(async (c) => {
      /**
       * AI 제안은 "같은 원문"에 대해 한 번만 만든다.
       *   유형(todo/issue/question)이 바뀌어도, 예전 키 형식(ai:<원문>:<유형>)으로 저장된
       *   기존 제안이 있어도 새로 만들지 않는다. 기존 행은 건드리지 않는다(완료·사람 수정 보존).
       */
      const aiAlreadyCovered = async (sourceId: string): Promise<boolean> => {
        if (!sourceId) return false;
        const r = await c.query<{ id: string }>(
          `SELECT id FROM pm_tasks
            WHERE brand_id=$1 AND origin='ai'
              AND (evidence_id = $2 OR dedupe_key = $3 OR dedupe_key LIKE $4)
            LIMIT 1`,
          [brandId, sourceId, `ai:${sourceId}`, `ai:${sourceId}:%`]);
        return r.rows.length > 0;
      };

      const ins = async (list: PmSuggestion[], origin: "rules" | "ai") => {
        let created = 0, refreshed = 0, skipped = 0;
        for (const sg of list) {
          if (origin === "ai" && await aiAlreadyCovered(sg.evidenceId)) { skipped++; continue; }
          // 이미 있는 제안은 "사람이 손대지 않았고 아직 열려 있을 때만" 최신 근거로 갱신한다.
          //   (KPI 수치·측정일이 바뀌면 옛 숫자가 그대로 남던 문제)
          //   사람이 수정했거나 확정·완료·보류한 제안은 그대로 둔다.
          const r = await c.query<{ id: string; inserted: boolean }>(
            `INSERT INTO pm_tasks (brand_id, kind, title, detail, priority, origin,
                evidence_kind, evidence_id, evidence_label, dedupe_key, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (brand_id, dedupe_key) WHERE dedupe_key IS NOT NULL
             DO UPDATE SET kind=EXCLUDED.kind, title=EXCLUDED.title, detail=EXCLUDED.detail,
                 priority=EXCLUDED.priority, evidence_label=EXCLUDED.evidence_label, updated_at=now()
               WHERE pm_tasks.edited_by_human = false
                 AND pm_tasks.confirmed_by IS NULL
                 AND pm_tasks.status IN ('open','doing','reopened')
             RETURNING id, (xmax = 0) AS inserted`,
            [brandId, sg.kind, sg.title.slice(0, 300), sg.detail.slice(0, 4000), sg.priority, origin,
             sg.evidenceKind.slice(0, 40), sg.evidenceId.slice(0, 100), sg.evidenceLabel.slice(0, 300),
             sg.dedupeKey.slice(0, 300), `pm:${origin}`]);
          if (r.rows.length === 0) skipped++;
          else if (r.rows[0].inserted) created++;
          else refreshed++;
        }
        return { created, refreshed, skipped };
      };
      const a = await ins(ruleList, "rules");
      const b = await ins(aiList, "ai");
      const created = a.created + b.created;
      const refreshed = a.refreshed + b.refreshed;
      const skipped = a.skipped + b.skipped;

      const summary = [
        mode === "ai" ? "AI(대화 본문) + 규칙 점검" : "규칙 점검만",
        `제안 ${ruleList.length + aiList.length}건(규칙 ${ruleList.length} · AI ${aiList.length})`,
        `신규 ${created} · 근거갱신 ${refreshed} · 유지 ${skipped}`,
        facts.channelErrors.length ? `대화 확인 실패 ${facts.channelErrors.length}채널` : "",
        `대화 ${facts.commCount}건 · KPI ${facts.kpis.length} · 열린 업무 ${facts.openTasks.length}`,
      ].filter(Boolean).join(" · ");
      const nextAction = nextActionLine([...ruleList, ...aiList], facts.openTasks);

      await c.query(
        "UPDATE pm_runs SET status='ok', mode=$2, summary=$3, created_count=$4, skipped_count=$5, finished_at=now() WHERE id=$1",
        [runId, mode, summary.slice(0, 500), created, skipped]);
      await c.query(
        `INSERT INTO pm_brand_config (brand_id, last_run_at, last_run_mode, last_status, last_error, last_summary, next_action)
         VALUES ($1, now(), $2, 'ok', NULL, $3, $4)
         ON CONFLICT (brand_id) DO UPDATE SET last_run_at=now(), last_run_mode=EXCLUDED.last_run_mode,
           last_status='ok', last_error=NULL, last_summary=EXCLUDED.last_summary,
           next_action=EXCLUDED.next_action, updated_at=now()`,
        [brandId, mode, summary.slice(0, 500), nextAction.slice(0, 300)]);

      return { created, refreshed, skipped, summary };
    });

    return {
      ok: true, mode, created: res.created, refreshed: res.refreshed,
      skipped: res.skipped, summary: res.summary, aiNote,
    };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await query("UPDATE pm_runs SET status='error', error=$2, finished_at=now() WHERE id=$1", [runId, msg]).catch(() => {});
    await query(
      `INSERT INTO pm_brand_config (brand_id, last_run_at, last_run_mode, last_status, last_error)
       VALUES ($1, now(), $2, 'error', $3)
       ON CONFLICT (brand_id) DO UPDATE SET last_run_at=now(), last_run_mode=EXCLUDED.last_run_mode,
         last_status='error', last_error=EXCLUDED.last_error, updated_at=now()`,
      [brandId, mode, msg]).catch(() => {});
    return { ok: false, mode, created: 0, refreshed: 0, skipped: 0, summary: "", error: `분석 실패 — ${msg}` };
  }
}

export interface PmRunRow { id: string; mode: string; status: string; summary: string; error: string | null; startedAt: string; finishedAt: string | null; triggeredBy: string }
export async function listPmRuns(brandId: string, limit = 10): Promise<PmRunRow[]> {
  const rows = await query<{
    id: string; mode: string; status: string; summary: string; error: string | null;
    started_at: string; finished_at: string | null; triggered_by: string;
  }>(
    `SELECT id, mode, status, summary, error, started_at::text AS started_at,
            finished_at::text AS finished_at, triggered_by
       FROM pm_runs WHERE brand_id=$1 ORDER BY started_at DESC LIMIT $2`, [brandId, limit]);
  return rows.map((r) => ({
    id: r.id, mode: r.mode, status: r.status, summary: r.summary, error: r.error,
    startedAt: r.started_at, finishedAt: r.finished_at, triggeredBy: r.triggered_by,
  }));
}

/**
 * 자동 운영 — 활성 브랜드 + PM opt-in 만, 정해진 개수까지.
 *   기존 보호된 cron(cronAuthorized)에서만 호출한다. 외부 발송 에이전트는 건드리지 않는다.
 */
export const PM_BATCH_BUDGET_MS = 45_000;

/** 자동 운영 대상 조건 — 브랜드가 켠(opt-in) 것만, 테스트 브랜드·종료 브랜드 제외. */
const PM_BATCH_WHERE = `p.enabled = true
        AND COALESCE(b.is_test,false) = false
        AND b.state NOT IN ('dropped','churned')`;

export interface PmBatchResult {
  /** 조건을 만족하는 전체 브랜드 수 — 밀린 양을 볼 수 있게 함께 돌려준다. */
  eligible: number;
  picked: number;
  ok: number;
  failed: number;
  /** 시간 예산 때문에 이번 회차에 남긴 수(다음 회차에서 먼저 처리된다). */
  remaining: number;
  stoppedForTime: boolean;
  notes: string[];
}

/**
 * 자동 운영 — 활성·opt-in 브랜드만, 정해진 개수·시간 예산 안에서만 돈다.
 *   공정 순환: last_run_at 이 가장 오래된 브랜드부터 집는다.
 *   성공이든 실패든 last_run_at 이 갱신되므로(runPmAnalysis 양쪽 경로 모두) 한 브랜드가
 *   계속 앞자리를 차지해 다른 브랜드가 굶는 일이 없다. 예산으로 남긴 브랜드는
 *   그만큼 last_run_at 이 더 오래돼 다음 회차에서 가장 먼저 처리된다.
 *   외부 발송은 하지 않는다(제안·업무 생성까지만).
 */
export async function runPmBatch(limit = 5, budgetMs = PM_BATCH_BUDGET_MS): Promise<PmBatchResult> {
  await releaseStalePmRuns().catch(() => 0);

  const total = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM pm_brand_config p
       JOIN brands b ON b.id = p.brand_id
      WHERE ${PM_BATCH_WHERE}`);
  const eligible = Number(total?.n ?? 0);

  const rows = await query<{ brand_id: string }>(
    `SELECT p.brand_id FROM pm_brand_config p
       JOIN brands b ON b.id = p.brand_id
      WHERE ${PM_BATCH_WHERE}
      ORDER BY COALESCE(p.last_run_at, '1970-01-01') ASC, p.brand_id ASC
      LIMIT $1`, [limit]);

  const notes: string[] = [];
  const t0 = Date.now();
  let ok = 0, failed = 0, done = 0, stoppedForTime = false;
  for (const r of rows) {
    if (Date.now() - t0 > budgetMs) { stoppedForTime = true; break; }
    done++;
    const res = await runPmAnalysis(r.brand_id, { triggeredBy: "cron" }).catch((e) => ({
      ok: false, mode: "rules" as const, created: 0, refreshed: 0, skipped: 0, summary: "", error: (e as Error).message,
    }));
    if (res.ok) ok++; else { failed++; notes.push(res.error ?? "실패"); }
  }
  return {
    eligible, picked: done, ok, failed,
    remaining: Math.max(0, eligible - done),
    stoppedForTime, notes: notes.slice(0, 5),
  };
}
