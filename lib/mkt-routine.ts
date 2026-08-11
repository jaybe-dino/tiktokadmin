// 마케팅 루틴 운영대행 — 계약 기간 + 매월 되돌이 회차(칸반). 시딩·라방 지속관리.
// 상수/타입은 DB 무관 모듈(mkt-routine-types)에서 재노출 — 클라이언트에서 값 import 시 pg 미유입.
import { query } from "./db";
import type { RoutineStage, RoutineCycle, RoutineProject } from "./mkt-routine-types";

export { ROUTINE_STAGES } from "./mkt-routine-types";
export type { RoutineStage, RoutineCycle, RoutineProject } from "./mkt-routine-types";

const nextYm = (ym: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  let y = Number(m[1]), mo = Number(m[2]) + 1;
  if (mo > 12) { mo = 1; y += 1; }
  return `${y}-${String(mo).padStart(2, "0")}`;
};

/** 루틴 프로젝트 + 월별 회차 조회. 마이그레이션(0065) 미적용 시 빈 배열. */
export async function listRoutineProjects(): Promise<RoutineProject[]> {
  const projs = await query<{ id: string; brand_id: string; brand_name: string; title: string; note: string | null; contract_start: string | null; contract_end: string | null }>(
    `SELECT mp.id, mp.brand_id, b.brand_name, mp.title, mp.note,
            mp.contract_start::text AS contract_start, mp.contract_end::text AS contract_end
       FROM mkt_projects mp JOIN brands b ON b.id=mp.brand_id
      WHERE mp.kind='routine' ORDER BY mp.updated_at DESC LIMIT 200`,
  ).catch(() => [] as never[]);
  if (projs.length === 0) return [];
  const ids = projs.map((p) => p.id);
  const cycles = await query<RoutineCycle>(
    `SELECT id, project_id, ym, stage, note, report_url FROM mkt_routine_cycles
      WHERE project_id = ANY($1::uuid[]) ORDER BY ym DESC`,
    [ids],
  ).catch(() => [] as RoutineCycle[]);
  const byProj = new Map<string, RoutineCycle[]>();
  for (const c of cycles) { const a = byProj.get(c.project_id) ?? []; a.push(c); byProj.set(c.project_id, a); }
  return projs.map((p) => ({ ...p, cycles: byProj.get(p.id) ?? [] }));
}

/** 회차 단계 이동. done 으로 이동 시 다음 달 회차를 자동 개설(되돌이표). */
export async function setCycleStage(cycleId: string, stage: RoutineStage): Promise<void> {
  const rows = await query<{ project_id: string; ym: string }>(
    "UPDATE mkt_routine_cycles SET stage=$2, updated_at=now() WHERE id=$1 RETURNING project_id, ym",
    [cycleId, stage],
  ).catch(() => [] as { project_id: string; ym: string }[]);
  const cur = rows[0];
  if (!cur || stage !== "done") return;
  // 되돌이표: 완료되면 다음 달 회차가 없으면 자동 개설(기획). 계약 종료월 초과면 개설 안 함.
  const ny = nextYm(cur.ym);
  const proj = await query<{ contract_end: string | null }>(
    "SELECT contract_end::text AS contract_end FROM mkt_projects WHERE id=$1", [cur.project_id],
  ).catch(() => [] as { contract_end: string | null }[]);
  const end = proj[0]?.contract_end;
  if (end && `${ny}-01` > end) return; // 계약 종료 이후면 자동 개설 중단
  await query(
    `INSERT INTO mkt_routine_cycles (project_id, ym, stage) VALUES ($1,$2,'plan')
     ON CONFLICT (project_id, ym) DO NOTHING`,
    [cur.project_id, ny],
  ).catch(() => {});
}
