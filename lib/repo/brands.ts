import { query, queryOne } from "../db";
import { isAhead } from "../states";
import type { Brand, State } from "../types";

export async function getBrand(id: string): Promise<Brand | null> {
  return queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [id]);
}

export async function recordStageHistory(
  brandId: string,
  fromState: State | null,
  toState: State,
  actor: string,
  gatePassed: boolean,
  reason = "",
): Promise<void> {
  await query(
    `INSERT INTO stage_history (brand_id, from_state, to_state, actor, gate_passed, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [brandId, fromState, toState, actor, gatePassed, reason],
  );
}

/**
 * ingest 전진 규칙: 후보 state 가 현재보다 퍼널상 앞이면 전진, 아니면 무시.
 * 게이트 미검증(시스템이 현실을 반영). 종료 상태로는 전진하지 않음.
 * 반환: 실제로 전진했으면 true.
 */
export async function advanceStateIfAhead(
  brand: Brand,
  candidate: State,
  actorSite: string,
): Promise<boolean> {
  if (candidate === "dropped" || candidate === "churned") return false;
  if (!isAhead(candidate, brand.state)) return false;
  await query(
    "UPDATE brands SET state=$2, stage_entered_at=now() WHERE id=$1",
    [brand.id, candidate],
  );
  await recordStageHistory(brand.id, brand.state, candidate, `ingest:${actorSite}`, true, "auto(ingest)");
  brand.state = candidate;
  return true;
}

/**
 * 비어있는 필드만 채우는 부분 업데이트 (dedup UPDATE 규칙: 기존값 보존).
 * fields 중 값이 있고 대상 컬럼이 비어있을 때만 세팅.
 */
export async function fillEmptyFields(
  brandId: string,
  fields: Partial<Record<keyof Brand, unknown>>,
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [brandId];
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined || val === null || val === "") continue;
    vals.push(val);
    // 기존값이 NULL/'' 일 때만 채움
    sets.push(`${col} = COALESCE(NULLIF(${col}::text,''), $${vals.length})::text`);
  }
  if (sets.length === 0) return;
  // COALESCE 캐스팅은 text 컬럼 전제. 복합 타입은 별도 setFields 사용.
  await query(`UPDATE brands SET ${sets.join(", ")} WHERE id=$1`, vals);
}

/** 지정 필드 강제 세팅(덮어쓰기). 진단 등 "더 최신이면 덮어씀" 케이스. */
export async function setFields(
  brandId: string,
  fields: Partial<Record<string, unknown>>,
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [brandId];
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  }
  if (sets.length === 0) return;
  await query(`UPDATE brands SET ${sets.join(", ")} WHERE id=$1`, vals);
}

export async function touchLastContact(brandId: string, at?: string): Promise<void> {
  await query("UPDATE brands SET last_contact_at = COALESCE($2, now()) WHERE id=$1", [
    brandId,
    at ?? null,
  ]);
}
