import { query } from "./db";
import type { Brand, State } from "./types";

// 단계별 커스텀 필수항목 (0002). 관리자가 설정, 전이 시 코드 게이트와 함께 강제.

export interface StageRequirement {
  id: string;
  state: string;
  kind: "check" | "field";
  field_key: string | null;
  label: string;
  required: boolean;
  sort: number;
  active: boolean;
}

/**
 * 순수 평가: 브랜드의 현재 단계에서 미충족인 활성·필수 요구항목 목록.
 *  · kind='field' → brands[field_key] 가 채워졌는지(배열은 length>0)
 *  · kind='check' → brand_stage_checks 에 done 인지(doneCheckIds)
 */
export function evaluateRequirements(
  brand: Brand,
  reqs: StageRequirement[],
  doneCheckIds: Set<string>,
): { rule: string; label: string }[] {
  const unmet: { rule: string; label: string }[] = [];
  for (const r of reqs) {
    if (!r.active || !r.required || r.state !== brand.state) continue;
    let ok = false;
    if (r.kind === "field" && r.field_key) {
      const v = (brand as unknown as Record<string, unknown>)[r.field_key];
      ok = Array.isArray(v) ? v.length > 0 : Boolean(v);
    } else if (r.kind === "check") {
      ok = doneCheckIds.has(r.id);
    }
    if (!ok) unmet.push({ rule: r.id, label: r.label });
  }
  return unmet;
}

/** DB: 브랜드 현재 단계의 미충족 필수항목(전이 게이트에서 사용). */
export async function checkStageRequirements(brand: Brand): Promise<{ rule: string; label: string }[]> {
  const reqs = await query<StageRequirement>(
    "SELECT * FROM stage_requirements WHERE state=$1 AND active ORDER BY sort",
    [brand.state],
  );
  if (reqs.length === 0) return [];
  const done = await query<{ req_id: string }>(
    "SELECT req_id FROM brand_stage_checks WHERE brand_id=$1 AND done",
    [brand.id],
  );
  return evaluateRequirements(brand, reqs, new Set(done.map((d) => d.req_id)));
}

/** 360 UI: 현재 단계의 check형 항목 + 완료 여부. */
export async function stageChecklist(
  brandId: string,
  state: State,
): Promise<{ id: string; label: string; field_key: string | null; kind: string; done: boolean }[]> {
  return query(
    `SELECT r.id, r.label, r.field_key, r.kind,
            COALESCE(c.done, false) AS done
       FROM stage_requirements r
       LEFT JOIN brand_stage_checks c ON c.req_id=r.id AND c.brand_id=$1
      WHERE r.state=$2 AND r.active
      ORDER BY r.sort`,
    [brandId, state],
  );
}

export async function setStageCheck(
  brandId: string,
  reqId: string,
  done: boolean,
  by: string,
): Promise<void> {
  await query(
    `INSERT INTO brand_stage_checks (brand_id, req_id, done, done_by, done_at)
     VALUES ($1,$2,$3,$4, CASE WHEN $3 THEN now() ELSE NULL END)
     ON CONFLICT (brand_id, req_id)
     DO UPDATE SET done=$3, done_by=$4, done_at=CASE WHEN $3 THEN now() ELSE NULL END`,
    [brandId, reqId, done, by],
  );
}

// ── 설정 CRUD (lead/exec) ────────────────────────────────────
export async function listAllRequirements(): Promise<StageRequirement[]> {
  return query<StageRequirement>("SELECT * FROM stage_requirements ORDER BY state, sort, created_at");
}

export async function addRequirement(input: {
  state: string;
  kind: "check" | "field";
  field_key?: string | null;
  label: string;
}): Promise<void> {
  const next = await query<{ n: number }>(
    "SELECT COALESCE(max(sort),0)+1 AS n FROM stage_requirements WHERE state=$1",
    [input.state],
  );
  await query(
    "INSERT INTO stage_requirements (state, kind, field_key, label, sort) VALUES ($1,$2,$3,$4,$5)",
    [input.state, input.kind, input.field_key ?? null, input.label, next[0]?.n ?? 1],
  );
}

export async function setRequirementActive(id: string, active: boolean): Promise<void> {
  await query("UPDATE stage_requirements SET active=$2 WHERE id=$1", [id, active]);
}

export async function deleteRequirement(id: string): Promise<void> {
  await query("DELETE FROM stage_requirements WHERE id=$1", [id]);
}
