// PM 1차 확장 — KPI 분류/합의·계약 조건·대화 추출·업무 연결·상단 요약의 DB 계층.
//   하위 레코드는 항상 `id AND brand_id` 로 좁힌다(다른 브랜드 id 혼입 차단).
//   이 파일에는 고객에게 무언가를 보내는 경로가 없다 — 내부 PM 기록만 다룬다.
import { query, queryOne, tx } from "./db";
import {
  KPI_KINDS, AGREEMENTS, TERM_KINDS, TERM_STATUSES, EXTRACT_KINDS,
  buildHeaderSummary, checkAgainstTerms, taskKeyForExtraction, kstDay,
  type KpiKind, type Agreement, type TermKind, type TermStatus, type ExtractKind,
  type BriefKpi, type BriefTask, type BriefExtraction, type PmHeaderSummary, type TermForCheck,
} from "./pm-brief";

export const PM_V2_MIGRATION = "0104_pm_v2.sql";
export const PM_V2_TABLES = ["pm_kpi_events", "pm_contract_terms", "pm_extractions", "pm_notify_config", "pm_notify_log"] as const;

export interface PmV2Schema { ready: boolean; missing: string[]; error?: string }

/** 0104 적용 여부 — 표와 pm_tasks 의 새 컬럼을 함께 확인한다. */
export async function pmV2Schema(): Promise<PmV2Schema> {
  try {
    const tables = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`, [[...PM_V2_TABLES]]);
    const have = new Set(tables.map((t) => t.table_name));
    const missing = PM_V2_TABLES.filter((t) => !have.has(t)) as string[];
    const cols = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='pm_tasks'
          AND column_name = ANY($1::text[])`, [["waiting_on", "result_evidence", "kpi_id", "extraction_id"]]);
    const haveCols = new Set(cols.map((c) => c.column_name));
    for (const c of ["waiting_on", "result_evidence", "kpi_id", "extraction_id"]) {
      if (!haveCols.has(c)) missing.push(`pm_tasks.${c}`);
    }
    const kcols = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='pm_kpis' AND column_name = ANY($1::text[])`,
      [["kind", "agreement", "source_quote"]]);
    const haveK = new Set(kcols.map((c) => c.column_name));
    for (const c of ["kind", "agreement", "source_quote"]) if (!haveK.has(c)) missing.push(`pm_kpis.${c}`);
    return { ready: missing.length === 0, missing };
  } catch (e) {
    return { ready: false, missing: [...PM_V2_TABLES], error: (e as Error).message.slice(0, 200) };
  }
}

const one = <T extends readonly string[]>(allowed: T, v: unknown, fb: T[number]): T[number] =>
  (allowed as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : fb;
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;   // 미확인 — 0 으로 적지 않는다
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const dayOrNull = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// ── KPI 분류·합의·근거·이력 ─────────────────────────────────
export interface KpiClassPatch {
  kind?: KpiKind; agreement?: Agreement;
  sourceQuote?: string; sourceAuthor?: string; sourceAt?: string | null;
  evidenceKind?: string; evidenceId?: string; evidenceUrl?: string;
}

/** KPI 분류·합의 상태·근거 원문 저장. 변경한 항목만 이력에 남는다. */
export async function setKpiClass(kpiId: string, brandId: string, patch: KpiClassPatch, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const before = await queryOne<{ kind: string; agreement: string }>(
    "SELECT kind, agreement FROM pm_kpis WHERE id=$1 AND brand_id=$2", [kpiId, brandId]);
  if (!before) return { ok: false, error: "이 브랜드의 KPI 가 아닙니다." };

  const kind = patch.kind ? one(KPI_KINDS, patch.kind, "internal") : before.kind;
  const agreement = patch.agreement ? one(AGREEMENTS, patch.agreement, "agreed") : before.agreement;

  await tx(async (c) => {
    await c.query(
      `UPDATE pm_kpis SET kind=$3, agreement=$4,
              source_quote=COALESCE($5, source_quote), source_author=COALESCE($6, source_author),
              source_at=COALESCE($7, source_at),
              evidence_kind=COALESCE($8, evidence_kind), evidence_id=COALESCE($9, evidence_id),
              evidence_url=COALESCE($10, evidence_url),
              edited_by_human=true, updated_at=now()
        WHERE id=$1 AND brand_id=$2`,
      [kpiId, brandId, kind, agreement,
       patch.sourceQuote === undefined ? null : txt(patch.sourceQuote, 4000),
       patch.sourceAuthor === undefined ? null : txt(patch.sourceAuthor, 200),
       patch.sourceAt === undefined ? null : patch.sourceAt,
       patch.evidenceKind === undefined ? null : txt(patch.evidenceKind, 40),
       patch.evidenceId === undefined ? null : txt(patch.evidenceId, 100),
       patch.evidenceUrl === undefined ? null : txt(patch.evidenceUrl, 600)]);
    if (kind !== before.kind) {
      await c.query(
        "INSERT INTO pm_kpi_events (kpi_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [kpiId, brandId, "kind", before.kind, kind, actor, ""]);
    }
    if (agreement !== before.agreement) {
      await c.query(
        "INSERT INTO pm_kpi_events (kpi_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [kpiId, brandId, "agreement", before.agreement, agreement, actor, ""]);
    }
  });
  return { ok: true };
}

/**
 * 후보 KPI 를 담당이 확인해 합의로 확정한다.
 *   확정에는 근거가 있어야 한다 — 근거 없는 목표를 합의로 올리지 않는다.
 */
// 이력 INSERT 는 어디서나 같은 컬럼 순서·전부 파라미터로 쓴다.
//   (SQL 리터럴을 섞으면 파라미터 번호가 밀려 다른 값이 다른 컬럼에 들어간다.)
export async function confirmKpi(kpiId: string, brandId: string, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const row = await queryOne<{ agreement: string; source_quote: string; evidence: string; evidence_id: string }>(
    "SELECT agreement, source_quote, evidence, evidence_id FROM pm_kpis WHERE id=$1 AND brand_id=$2",
    [kpiId, brandId]);
  if (!row) return { ok: false, error: "이 브랜드의 KPI 가 아닙니다." };
  if (!(row.source_quote || row.evidence || row.evidence_id)) {
    return { ok: false, error: "근거(원문·링크·회의)를 먼저 적어야 확정할 수 있습니다." };
  }
  await tx(async (c) => {
    await c.query(
      `UPDATE pm_kpis SET agreement='agreed', confirmed_by=$3, confirmed_at=now(), updated_at=now()
        WHERE id=$1 AND brand_id=$2`, [kpiId, brandId, actor]);
    await c.query(
      "INSERT INTO pm_kpi_events (kpi_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [kpiId, brandId, "agreement", row.agreement, "agreed", actor, "담당 확인"]);
  });
  return { ok: true };
}

export interface KpiEvent { field: string; oldValue: string; newValue: string; actor: string; note: string; at: string }
export async function listKpiEvents(kpiId: string, brandId: string, limit = 50): Promise<KpiEvent[]> {
  const rows = await query<{ field: string; old_value: string; new_value: string; actor: string; note: string; at: string }>(
    `SELECT field, old_value, new_value, actor, note, at::text AS at
       FROM pm_kpi_events WHERE kpi_id=$1 AND brand_id=$2 ORDER BY at DESC LIMIT $3`,
    [kpiId, brandId, limit]);
  return rows.map((r) => ({ field: r.field, oldValue: r.old_value, newValue: r.new_value, actor: r.actor, note: r.note, at: r.at }));
}

/** 값 변경(목표·현재값·기간·담당)을 이력으로 남긴다 — 기존 updatePmKpi 호출 뒤에 붙여 쓴다. */
export async function logKpiValueChange(kpiId: string, brandId: string, actor: string,
  changes: { field: string; from: string; to: string }[]): Promise<void> {
  for (const ch of changes) {
    if (ch.from === ch.to) continue;
    await query(
      "INSERT INTO pm_kpi_events (kpi_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [kpiId, brandId, ch.field.slice(0, 40), ch.from.slice(0, 300), ch.to.slice(0, 300), actor, ""]).catch(() => {});
  }
}

export async function listKpisForBrief(brandId: string): Promise<BriefKpi[]> {
  const rows = await query<{
    id: string; name: string; unit: string; kind: string; agreement: string;
    target_value: string | null; current_value: string | null; measured_at: string | null;
    direction: string; period_start: string | null; period_end: string | null;
    owner_admin_id: string | null; source_quote: string; evidence: string; status: string;
  }>(
    `SELECT id, name, unit, kind, agreement, target_value, current_value,
            measured_at::text AS measured_at, direction,
            period_start::text AS period_start, period_end::text AS period_end,
            owner_admin_id, source_quote, evidence, status
       FROM pm_kpis WHERE brand_id=$1 ORDER BY kind, period_end NULLS LAST, name`, [brandId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, unit: r.unit,
    kind: one(KPI_KINDS, r.kind, "internal"), agreement: one(AGREEMENTS, r.agreement, "agreed"),
    target: numOrNull(r.target_value), current: numOrNull(r.current_value),
    measuredAt: r.measured_at, direction: r.direction === "down" ? "down" : "up",
    periodStart: r.period_start, periodEnd: r.period_end, owner: r.owner_admin_id,
    sourceQuote: r.source_quote ?? "", evidenceLabel: r.evidence ?? "", status: r.status,
  }));
}

// ── 계약 조건 ───────────────────────────────────────────────
export interface ContractTerm {
  id: string; kind: TermKind; label: string; detail: string;
  quantity: number | null; unit: string;
  periodStart: string | null; periodEnd: string | null;
  status: TermStatus;
  evidenceLabel: string; evidenceUrl: string;
  sourceQuote: string; sourceAuthor: string; sourceAt: string | null;
  confirmedBy: string | null; createdAt: string; updatedAt: string;
}
export interface TermInput {
  kind?: TermKind; label: string; detail?: string;
  quantity?: number | string | null; unit?: string;
  periodStart?: string | null; periodEnd?: string | null;
  status?: TermStatus;
  evidenceLabel?: string; evidenceUrl?: string;
  sourceQuote?: string; sourceAuthor?: string; sourceAt?: string | null;
}

const TERM_COLS = `id, kind, label, detail, quantity, unit,
  period_start::text AS period_start, period_end::text AS period_end, status,
  evidence_label, evidence_url, source_quote, source_author, source_at::text AS source_at,
  confirmed_by, created_at::text AS created_at, updated_at::text AS updated_at`;

interface TermRow {
  id: string; kind: string; label: string; detail: string; quantity: string | null; unit: string;
  period_start: string | null; period_end: string | null; status: string;
  evidence_label: string; evidence_url: string; source_quote: string; source_author: string;
  source_at: string | null; confirmed_by: string | null; created_at: string; updated_at: string;
}
const toTerm = (r: TermRow): ContractTerm => ({
  id: r.id, kind: one(TERM_KINDS, r.kind, "scope"), label: r.label, detail: r.detail,
  quantity: numOrNull(r.quantity), unit: r.unit,
  periodStart: r.period_start, periodEnd: r.period_end, status: one(TERM_STATUSES, r.status, "candidate"),
  evidenceLabel: r.evidence_label, evidenceUrl: r.evidence_url,
  sourceQuote: r.source_quote, sourceAuthor: r.source_author, sourceAt: r.source_at,
  confirmedBy: r.confirmed_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function listContractTerms(brandId: string): Promise<ContractTerm[]> {
  const rows = await query<TermRow>(
    `SELECT ${TERM_COLS} FROM pm_contract_terms WHERE brand_id=$1 ORDER BY kind, created_at`, [brandId]);
  return rows.map(toTerm);
}

export async function createContractTerm(brandId: string, input: TermInput, actor: string): Promise<string> {
  const label = txt(input.label, 300);
  if (!label) throw new Error("항목 이름을 입력하세요.");
  const r = await queryOne<{ id: string }>(
    `INSERT INTO pm_contract_terms
       (brand_id, kind, label, detail, quantity, unit, period_start, period_end, status,
        evidence_label, evidence_url, source_quote, source_author, source_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [brandId, one(TERM_KINDS, input.kind, "scope"), label, txt(input.detail, 4000),
     numOrNull(input.quantity), txt(input.unit, 40),
     dayOrNull(input.periodStart), dayOrNull(input.periodEnd),
     one(TERM_STATUSES, input.status, "candidate"),
     txt(input.evidenceLabel, 300), txt(input.evidenceUrl, 600),
     txt(input.sourceQuote, 4000), txt(input.sourceAuthor, 200),
     input.sourceAt ?? null, actor]);
  if (!r) throw new Error("계약 조건 저장 실패");
  return r.id;
}

export async function updateContractTerm(termId: string, brandId: string, input: TermInput):
  Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ id: string }>(
    `UPDATE pm_contract_terms SET kind=$3, label=$4, detail=$5, quantity=$6, unit=$7,
            period_start=$8, period_end=$9, status=$10,
            evidence_label=$11, evidence_url=$12, source_quote=$13, source_author=$14,
            updated_at=now()
      WHERE id=$1 AND brand_id=$2 RETURNING id`,
    [termId, brandId, one(TERM_KINDS, input.kind, "scope"), txt(input.label, 300), txt(input.detail, 4000),
     numOrNull(input.quantity), txt(input.unit, 40), dayOrNull(input.periodStart), dayOrNull(input.periodEnd),
     one(TERM_STATUSES, input.status, "candidate"),
     txt(input.evidenceLabel, 300), txt(input.evidenceUrl, 600),
     txt(input.sourceQuote, 4000), txt(input.sourceAuthor, 200)]);
  if (r.length === 0) return { ok: false, error: "이 브랜드의 계약 조건이 아닙니다." };
  return { ok: true };
}

/** 계약 조건 확정 — 근거 없이는 확정하지 않는다. */
export async function confirmContractTerm(termId: string, brandId: string, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const row = await queryOne<{ source_quote: string; evidence_label: string; evidence_url: string }>(
    "SELECT source_quote, evidence_label, evidence_url FROM pm_contract_terms WHERE id=$1 AND brand_id=$2",
    [termId, brandId]);
  if (!row) return { ok: false, error: "이 브랜드의 계약 조건이 아닙니다." };
  if (!(row.source_quote || row.evidence_label || row.evidence_url)) {
    return { ok: false, error: "근거(계약 문구·문서 링크)를 먼저 적어야 확정할 수 있습니다." };
  }
  await query(
    `UPDATE pm_contract_terms SET status='agreed', confirmed_by=$3, confirmed_at=now(), updated_at=now()
      WHERE id=$1 AND brand_id=$2`, [termId, brandId, actor]);
  return { ok: true };
}

export async function deleteContractTerm(termId: string, brandId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ id: string }>(
    "DELETE FROM pm_contract_terms WHERE id=$1 AND brand_id=$2 RETURNING id", [termId, brandId]);
  if (r.length === 0) return { ok: false, error: "이 브랜드의 계약 조건이 아닙니다." };
  return { ok: true };
}

// ── 대화 추출 ───────────────────────────────────────────────
export interface Extraction {
  id: string; kind: ExtractKind; title: string; detail: string;
  contractCheck: string; contractTermId: string | null; contractNote: string;
  evidenceKind: string; evidenceId: string; evidenceUrl: string; evidenceLabel: string;
  sourceQuote: string; sourceAuthor: string; occurredAt: string | null;
  replyDraft: string; internalChecks: string;
  status: string; origin: string;
  confirmedBy: string | null; answeredBy: string | null;
  editedByHuman: boolean; createdAt: string;
  /** 이 추출에서 만든 업무가 있으면 그 id. */
  taskId: string | null;
}
const EXT_COLS = `e.id, e.kind, e.title, e.detail, e.contract_check, e.contract_term_id, e.contract_note,
  e.evidence_kind, e.evidence_id, e.evidence_url, e.evidence_label,
  e.source_quote, e.source_author, e.occurred_at::text AS occurred_at,
  e.reply_draft, e.internal_checks, e.status, e.origin,
  e.confirmed_by, e.answered_by, e.edited_by_human, e.created_at::text AS created_at,
  (SELECT t.id::text FROM pm_tasks t WHERE t.extraction_id = e.id LIMIT 1) AS task_id`;

export async function listExtractions(brandId: string, opts: { status?: "open" | "all" } = {}): Promise<Extraction[]> {
  const cond = (opts.status ?? "open") === "open" ? "AND e.status IN ('new','confirmed')" : "";
  const rows = await query<Record<string, unknown>>(
    `SELECT ${EXT_COLS} FROM pm_extractions e WHERE e.brand_id=$1 ${cond}
      ORDER BY (e.contract_check='conflict') DESC, e.status, e.occurred_at DESC NULLS LAST, e.created_at DESC`,
    [brandId]);
  return rows.map((r) => ({
    id: String(r.id), kind: one(EXTRACT_KINDS, r.kind, "open"), title: String(r.title ?? ""),
    detail: String(r.detail ?? ""), contractCheck: String(r.contract_check ?? "unknown"),
    contractTermId: r.contract_term_id ? String(r.contract_term_id) : null,
    contractNote: String(r.contract_note ?? ""),
    evidenceKind: String(r.evidence_kind ?? ""), evidenceId: String(r.evidence_id ?? ""),
    evidenceUrl: String(r.evidence_url ?? ""), evidenceLabel: String(r.evidence_label ?? ""),
    sourceQuote: String(r.source_quote ?? ""), sourceAuthor: String(r.source_author ?? ""),
    occurredAt: r.occurred_at ? String(r.occurred_at) : null,
    replyDraft: String(r.reply_draft ?? ""), internalChecks: String(r.internal_checks ?? ""),
    status: String(r.status ?? "new"), origin: String(r.origin ?? "ai"),
    confirmedBy: r.confirmed_by ? String(r.confirmed_by) : null,
    answeredBy: r.answered_by ? String(r.answered_by) : null,
    editedByHuman: Boolean(r.edited_by_human), createdAt: String(r.created_at ?? ""),
    taskId: r.task_id ? String(r.task_id) : null,
  }));
}

export interface ExtractionInput {
  kind?: ExtractKind; title: string; detail?: string;
  evidenceKind?: string; evidenceId?: string; evidenceUrl?: string; evidenceLabel?: string;
  sourceQuote?: string; sourceAuthor?: string; occurredAt?: string | null;
  replyDraft?: string; internalChecks?: string;
  contractCheck?: string; contractTermId?: string | null; contractNote?: string;
  origin?: "ai" | "rules" | "human";
  dedupeKey?: string | null;
}

/** 추출 저장. dedupe_key 가 있으면 같은 근거·종류로 다시 만들지 않는다. */
export async function upsertExtraction(brandId: string, input: ExtractionInput, actor: string):
  Promise<{ id: string | null; created: boolean }> {
  const title = txt(input.title, 300);
  if (!title) return { id: null, created: false };
  const r = await queryOne<{ id: string; inserted: boolean }>(
    `INSERT INTO pm_extractions
       (brand_id, kind, title, detail, evidence_kind, evidence_id, evidence_url, evidence_label,
        source_quote, source_author, occurred_at, reply_draft, internal_checks,
        contract_check, contract_term_id, contract_note, origin, dedupe_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (brand_id, dedupe_key) DO UPDATE SET
       -- 사람이 손댄 항목·처리 완료 항목은 덮어쓰지 않는다.
       contract_check=EXCLUDED.contract_check,
       contract_term_id=EXCLUDED.contract_term_id,
       contract_note=EXCLUDED.contract_note,
       updated_at=now()
       WHERE pm_extractions.edited_by_human = false
         AND pm_extractions.status IN ('new','confirmed')
     RETURNING id, (xmax = 0) AS inserted`,
    [brandId, one(EXTRACT_KINDS, input.kind, "open"), title, txt(input.detail, 4000),
     txt(input.evidenceKind, 40), txt(input.evidenceId, 100), txt(input.evidenceUrl, 600),
     txt(input.evidenceLabel, 300), txt(input.sourceQuote, 4000), txt(input.sourceAuthor, 200),
     input.occurredAt ?? null, txt(input.replyDraft, 4000), txt(input.internalChecks, 4000),
     one(["unknown", "within", "outside", "conflict"] as const, input.contractCheck, "unknown"),
     input.contractTermId ?? null, txt(input.contractNote, 1000),
     input.origin ?? "human", input.dedupeKey ?? null, actor]);
  return { id: r?.id ?? null, created: Boolean(r?.inserted) };
}

export async function setExtractionStatus(extractionId: string, brandId: string, status: string, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const allowed = ["new", "confirmed", "answered", "dismissed"];
  if (!allowed.includes(status)) return { ok: false, error: "알 수 없는 상태입니다." };
  const set = status === "confirmed" ? "confirmed_by=$4, confirmed_at=now()"
    : status === "answered" ? "answered_by=$4, answered_at=now()" : "answered_by=answered_by";
  const r = await query<{ id: string }>(
    `UPDATE pm_extractions SET status=$3, ${set}, updated_at=now()
      WHERE id=$1 AND brand_id=$2 RETURNING id`,
    status === "confirmed" || status === "answered" ? [extractionId, brandId, status, actor] : [extractionId, brandId, status]);
  if (r.length === 0) return { ok: false, error: "이 브랜드의 항목이 아닙니다." };
  return { ok: true };
}

/** 답변 초안·내부 확인사항을 사람이 고친다. 이후 자동 실행이 덮어쓰지 않는다. */
export async function editExtraction(extractionId: string, brandId: string,
  patch: { replyDraft?: string; internalChecks?: string; contractNote?: string; contractCheck?: string }):
  Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ id: string }>(
    `UPDATE pm_extractions SET
        reply_draft=COALESCE($3, reply_draft),
        internal_checks=COALESCE($4, internal_checks),
        contract_note=COALESCE($5, contract_note),
        contract_check=COALESCE($6, contract_check),
        edited_by_human=true, updated_at=now()
      WHERE id=$1 AND brand_id=$2 RETURNING id`,
    [extractionId, brandId,
     patch.replyDraft === undefined ? null : txt(patch.replyDraft, 4000),
     patch.internalChecks === undefined ? null : txt(patch.internalChecks, 4000),
     patch.contractNote === undefined ? null : txt(patch.contractNote, 1000),
     patch.contractCheck === undefined ? null : one(["unknown", "within", "outside", "conflict"] as const, patch.contractCheck, "unknown")]);
  if (r.length === 0) return { ok: false, error: "이 브랜드의 항목이 아닙니다." };
  return { ok: true };
}

/**
 * 추출 → 담당 업무 만들기. 같은 추출에서 업무는 1개만 생긴다(중복 업무 방지).
 *   업무는 사람이 만든 것으로 기록하고(확정), 근거는 추출의 원문을 그대로 이어받는다.
 */
export async function taskFromExtraction(extractionId: string, brandId: string,
  opts: { owner?: string | null; dueDate?: string | null; kpiId?: string | null; waitingOn?: string }, actor: string):
  Promise<{ ok: boolean; error?: string; taskId?: string; already?: boolean }> {
  const e = await queryOne<{
    kind: string; title: string; detail: string; evidence_kind: string; evidence_id: string;
    evidence_url: string; evidence_label: string;
  }>(`SELECT kind, title, detail, evidence_kind, evidence_id, evidence_url, evidence_label
        FROM pm_extractions WHERE id=$1 AND brand_id=$2`, [extractionId, brandId]);
  if (!e) return { ok: false, error: "이 브랜드의 항목이 아닙니다." };

  const exists = await queryOne<{ id: string }>(
    "SELECT id FROM pm_tasks WHERE extraction_id=$1 AND brand_id=$2 LIMIT 1", [extractionId, brandId]);
  if (exists) return { ok: true, taskId: exists.id, already: true };

  const taskKind = e.kind === "question" ? "question" : e.kind === "open" ? "issue" : "todo";
  const r = await queryOne<{ id: string }>(
    `INSERT INTO pm_tasks
       (brand_id, kind, title, detail, priority, owner_admin_id, due_date, status, origin,
        confirmed_by, confirmed_at, evidence_kind, evidence_id, evidence_url, evidence_label,
        dedupe_key, kpi_id, extraction_id, waiting_on, created_by)
     VALUES ($1,$2,$3,$4,2,$5,$6,'open','human',$7,now(),$8,$9,$10,$11,$12,$13,$14,$15,$7)
     ON CONFLICT (brand_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [brandId, taskKind, e.title.slice(0, 300), e.detail.slice(0, 4000),
     (opts.owner ?? "").trim().toLowerCase() || null, dayOrNull(opts.dueDate), actor,
     e.evidence_kind, e.evidence_id, e.evidence_url, e.evidence_label,
     taskKeyForExtraction(extractionId), opts.kpiId ?? null, extractionId,
     one(["none", "customer", "internal"] as const, opts.waitingOn, "none")]);
  if (!r) {
    const again = await queryOne<{ id: string }>(
      "SELECT id FROM pm_tasks WHERE brand_id=$1 AND dedupe_key=$2", [brandId, taskKeyForExtraction(extractionId)]);
    return { ok: true, taskId: again?.id, already: true };
  }
  await query(
    "INSERT INTO pm_task_events (task_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [r.id, brandId, "created", "", "대화 추출에서 생성", actor, `추출 ${extractionId}`]).catch(() => {});
  return { ok: true, taskId: r.id };
}

// ── 업무 확장(대기 주체 · 실행결과 · KPI 연결) ──────────────
export async function setTaskWaiting(taskId: string, brandId: string, waitingOn: string, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const w = one(["none", "customer", "internal"] as const, waitingOn, "none");
  const before = await queryOne<{ waiting_on: string }>(
    "SELECT waiting_on FROM pm_tasks WHERE id=$1 AND brand_id=$2", [taskId, brandId]);
  if (!before) return { ok: false, error: "이 브랜드의 업무가 아닙니다." };
  await tx(async (c) => {
    await c.query(
      `UPDATE pm_tasks SET waiting_on=$3, waiting_since = CASE WHEN $3='none' THEN NULL ELSE now() END,
              edited_by_human=true, updated_at=now() WHERE id=$1 AND brand_id=$2`,
      [taskId, brandId, w]);
    await c.query(
      "INSERT INTO pm_task_events (task_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [taskId, brandId, "waiting_on", before.waiting_on, w, actor, ""]);
  });
  return { ok: true };
}

export async function setTaskKpi(taskId: string, brandId: string, kpiId: string | null, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  if (kpiId) {
    // 다른 브랜드의 KPI 를 붙이지 못하게 확인한다.
    const k = await queryOne<{ id: string }>("SELECT id FROM pm_kpis WHERE id=$1 AND brand_id=$2", [kpiId, brandId]);
    if (!k) return { ok: false, error: "이 브랜드의 KPI 가 아닙니다." };
  }
  const r = await query<{ id: string }>(
    "UPDATE pm_tasks SET kpi_id=$3, edited_by_human=true, updated_at=now() WHERE id=$1 AND brand_id=$2 RETURNING id",
    [taskId, brandId, kpiId]);
  if (r.length === 0) return { ok: false, error: "이 브랜드의 업무가 아닙니다." };
  await query(
    "INSERT INTO pm_task_events (task_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [taskId, brandId, "kpi_id", "", kpiId ?? "(해제)", actor, ""]).catch(() => {});
  return { ok: true };
}

/**
 * 실행결과 기록. 완료로 넘기려면 근거가 있어야 한다 —
 *   근거 없는 완료는 나중에 성과 학습의 기준이 될 수 없기 때문이다.
 */
export async function setTaskResult(taskId: string, brandId: string,
  input: { resultNote?: string; resultEvidence?: string; complete?: boolean }, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const before = await queryOne<{ status: string; result_evidence: string }>(
    "SELECT status, result_evidence FROM pm_tasks WHERE id=$1 AND brand_id=$2", [taskId, brandId]);
  if (!before) return { ok: false, error: "이 브랜드의 업무가 아닙니다." };
  const evidence = input.resultEvidence === undefined ? before.result_evidence : txt(input.resultEvidence, 2000);
  if (input.complete && !evidence.trim()) {
    return { ok: false, error: "완료 근거를 적어야 완료로 넘길 수 있습니다." };
  }
  await tx(async (c) => {
    await c.query(
      `UPDATE pm_tasks SET result_note=COALESCE($3, result_note), result_evidence=$4,
              result_at = CASE WHEN $5 THEN now() ELSE result_at END,
              status = CASE WHEN $5 THEN 'done' ELSE status END,
              waiting_on = CASE WHEN $5 THEN 'none' ELSE waiting_on END,
              edited_by_human=true, updated_at=now()
        WHERE id=$1 AND brand_id=$2`,
      [taskId, brandId, input.resultNote === undefined ? null : txt(input.resultNote, 4000),
       evidence, Boolean(input.complete)]);
    if (input.complete) {
      await c.query(
        "INSERT INTO pm_task_events (task_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [taskId, brandId, "status", before.status, "done", actor, `완료 근거: ${evidence.slice(0, 200)}`]);
    } else {
      await c.query(
        "INSERT INTO pm_task_events (task_id, brand_id, field, old_value, new_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [taskId, brandId, "result", "", (input.resultNote ?? evidence).slice(0, 300), actor, ""]);
    }
  });
  return { ok: true };
}

export async function listTasksForBrief(brandId: string): Promise<BriefTask[]> {
  const rows = await query<{
    id: string; kind: string; title: string; priority: number; owner_admin_id: string | null;
    due_date: string | null; status: string; waiting_on: string; origin: string;
    confirmed_by: string | null; kpi_id: string | null;
  }>(
    `SELECT id, kind, title, priority, owner_admin_id, due_date::text AS due_date, status,
            waiting_on, origin, confirmed_by, kpi_id::text AS kpi_id
       FROM pm_tasks WHERE brand_id=$1`, [brandId]);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, priority: r.priority, owner: r.owner_admin_id,
    dueDate: r.due_date, status: r.status, waitingOn: r.waiting_on ?? "none",
    origin: r.origin, confirmedBy: r.confirmed_by, kpiId: r.kpi_id,
  }));
}

export async function listExtractionsForBrief(brandId: string): Promise<BriefExtraction[]> {
  const rows = await query<{
    id: string; kind: string; title: string; contract_check: string; status: string;
    occurred_at: string | null; source_author: string; evidence_label: string; reply_draft: string;
  }>(
    `SELECT id, kind, title, contract_check, status, occurred_at::text AS occurred_at,
            source_author, evidence_label, reply_draft
       FROM pm_extractions WHERE brand_id=$1`, [brandId]);
  return rows.map((r) => ({
    id: r.id, kind: one(EXTRACT_KINDS, r.kind, "open"), title: r.title,
    contractCheck: one(["unknown", "within", "outside", "conflict"] as const, r.contract_check, "unknown"),
    status: r.status, occurredAt: r.occurred_at, sourceAuthor: r.source_author,
    evidenceLabel: r.evidence_label, hasReplyDraft: Boolean((r.reply_draft ?? "").trim()),
  }));
}

// ── 상단 요약 ───────────────────────────────────────────────
/**
 * 브랜드360 상단 요약. 0104 미적용·표 없음 등은 사유를 담아 돌려준다(빈 값으로 숨기지 않는다).
 *   caveats 에는 수집이 연결되지 않은 채널을 그대로 적는다.
 */
export async function pmHeaderSummary(brandId: string, caveats: string[] = []): Promise<PmHeaderSummary> {
  const empty = (msg: string): PmHeaderSummary => ({
    unavailable: msg, keyKpis: [], top3: [], blockers: [], awaiting: [],
    counts: { openTasks: 0, overdue: 0, waitingCustomer: 0, waitingInternal: 0, unconfirmedKpis: 0 },
    asOf: new Date().toISOString(), caveats,
  });
  const schema = await pmV2Schema();
  if (!schema.ready) {
    return empty(`마이그레이션 ${PM_V2_MIGRATION} 미적용 — 없는 항목: ${schema.missing.slice(0, 4).join(", ")}${schema.error ? ` (${schema.error})` : ""}`);
  }
  try {
    const [kpis, tasks, extractions, terms] = await Promise.all([
      listKpisForBrief(brandId), listTasksForBrief(brandId),
      listExtractionsForBrief(brandId), listContractTerms(brandId),
    ]);
    return buildHeaderSummary({
      kpis, tasks, extractions,
      contractDisputes: terms.filter((t) => t.status === "disputed").map((t) => ({ id: t.id, label: t.label })),
      caveats, today: kstDay(),
    });
  } catch (e) {
    return empty(`PM 요약을 불러오지 못했습니다 — ${(e as Error).message.slice(0, 160)}`);
  }
}

/** 계약 대조를 지금 등록된 조건으로 다시 계산한다(사람이 고친 항목은 건드리지 않는다). */
export async function recheckContracts(brandId: string): Promise<{ updated: number; unknown: number }> {
  const terms = await listContractTerms(brandId);
  const forCheck: TermForCheck[] = terms.map((t) => ({
    id: t.id, kind: t.kind, label: t.label, detail: t.detail,
    quantity: t.quantity, unit: t.unit, status: t.status,
  }));
  const rows = await query<{ id: string; title: string; detail: string; source_quote: string }>(
    `SELECT id, title, detail, source_quote FROM pm_extractions
      WHERE brand_id=$1 AND edited_by_human=false AND status IN ('new','confirmed')`, [brandId]);
  let updated = 0, unknownN = 0;
  for (const r of rows) {
    const res = checkAgainstTerms(`${r.title} ${r.detail} ${r.source_quote}`, forCheck);
    if (res.check === "unknown") unknownN += 1;
    await query(
      `UPDATE pm_extractions SET contract_check=$3, contract_term_id=$4, contract_note=$5, updated_at=now()
        WHERE id=$1 AND brand_id=$2`,
      [r.id, brandId, res.check, res.termId, res.note.slice(0, 1000)]);
    updated += 1;
  }
  return { updated, unknown: unknownN };
}

/** 업무의 대기 주체·실행결과·연결 KPI — 화면에서 버킷과 함께 보여준다. */
export interface TaskResultRow {
  id: string; title: string; kind: string; status: string; priority: number;
  owner: string | null; dueDate: string | null; waitingOn: string;
  resultNote: string; resultEvidence: string; resultAt: string | null;
  kpiId: string | null; kpiName: string | null;
  extractionId: string | null;
}
export async function listTaskResults(brandId: string): Promise<TaskResultRow[]> {
  const rows = await query<{
    id: string; title: string; kind: string; status: string; priority: number;
    owner_admin_id: string | null; due_date: string | null; waiting_on: string;
    result_note: string; result_evidence: string; result_at: string | null;
    kpi_id: string | null; kpi_name: string | null; extraction_id: string | null;
  }>(
    `SELECT t.id, t.title, t.kind, t.status, t.priority, t.owner_admin_id,
            t.due_date::text AS due_date, t.waiting_on,
            t.result_note, t.result_evidence, t.result_at::text AS result_at,
            t.kpi_id::text AS kpi_id, k.name AS kpi_name, t.extraction_id::text AS extraction_id
       FROM pm_tasks t LEFT JOIN pm_kpis k ON k.id = t.kpi_id AND k.brand_id = t.brand_id
      WHERE t.brand_id=$1
      ORDER BY t.status, t.priority, t.due_date NULLS LAST`, [brandId]);
  return rows.map((r) => ({
    id: r.id, title: r.title, kind: r.kind, status: r.status, priority: r.priority,
    owner: r.owner_admin_id, dueDate: r.due_date, waitingOn: r.waiting_on ?? "none",
    resultNote: r.result_note ?? "", resultEvidence: r.result_evidence ?? "", resultAt: r.result_at,
    kpiId: r.kpi_id, kpiName: r.kpi_name, extractionId: r.extraction_id,
  }));
}
