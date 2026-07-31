// 담당자 배치 엔진 (09-B) — 결정은 사람(파트장), 시스템은 후보·부하 표시.
import { query, queryOne } from "./db";
import type { OwnerField } from "./types";

export interface Candidate {
  user: string; name: string; score: number; load: number; breaches: number; reason: string;
}

const ROLE_TO_TEAM_PART: Record<OwnerField, string> = {
  owner_intake: "intake", owner_sales: "sales", owner_onboard: "onboard", owner_ads: "ads",
};

/** 역할별 후보 3명 + 부하. 산정: 같은 카테고리 경험, 현재 커버 수, SLA 위반 수. */
export async function suggestAssignee(brandId: string, role: OwnerField): Promise<Candidate[]> {
  const brand = await queryOne<{ category: string }>("SELECT category FROM brands WHERE id=$1", [brandId]);
  const part = ROLE_TO_TEAM_PART[role];

  // 후보군: 해당 파트 팀 소속 또는 role 접두 역할을 가진 활성 사용자.
  const users = await query<{ id: string; name: string }>(
    `SELECT DISTINCT au.id, au.name FROM admin_users au
      LEFT JOIN teams t ON t.id=au.team_id
      WHERE au.active AND (t.part=$1 OR au.role=$1 OR au.role='lead')`,
    [part]);

  const cands: Candidate[] = [];
  for (const u of users) {
    const load = await queryOne<{ n: string }>(
      `SELECT count(*)::text n FROM brands WHERE ${role}=$1 AND state NOT IN ('dropped','churned')`, [u.id]);
    const breaches = await queryOne<{ n: string }>(
      `SELECT count(*)::text n FROM alerts a JOIN brands b ON b.id=a.brand_id
        WHERE b.${role}=$1 AND a.kind='sla_breach' AND a.resolved_at IS NULL`, [u.id]);
    const catExp = await queryOne<{ n: string }>(
      `SELECT count(*)::text n FROM brands WHERE ${role}=$1 AND category=$2`, [u.id, brand?.category ?? ""]);

    const loadN = Number(load?.n ?? 0);
    const breachN = Number(breaches?.n ?? 0);
    const catN = Number(catExp?.n ?? 0);
    // 점수: 카테고리 경험 가점, 부하·위반 감점.
    const score = catN * 3 - loadN - breachN * 2;
    const reasons = [];
    if (catN > 0) reasons.push(`${brand?.category} 경험 ${catN}건`);
    reasons.push(`커버 ${loadN}`);
    if (breachN > 0) reasons.push(`⚠️위반 ${breachN}`);
    cands.push({ user: u.id, name: u.name, score, load: loadN, breaches: breachN, reason: reasons.join(" · ") });
  }
  return cands.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** 부하 대시보드 (09-B-5). */
export interface LoadRow {
  id: string; name: string; role: string;
  intake: number; sales: number; onboard: number; ads: number; breaches: number; no_reply: number;
}
export async function loadDashboard(): Promise<LoadRow[]> {
  return query<LoadRow>(
    `SELECT au.id, au.name, au.role,
       (SELECT count(*) FROM brands b WHERE b.owner_intake=au.id AND b.state NOT IN ('dropped','churned'))::int intake,
       (SELECT count(*) FROM brands b WHERE b.owner_sales=au.id AND b.state NOT IN ('dropped','churned'))::int sales,
       (SELECT count(*) FROM brands b WHERE b.owner_onboard=au.id AND b.state NOT IN ('dropped','churned'))::int onboard,
       (SELECT count(*) FROM brands b WHERE b.owner_ads=au.id AND b.state NOT IN ('dropped','churned'))::int ads,
       (SELECT count(*) FROM alerts a JOIN brands b ON b.id=a.brand_id
          WHERE a.kind='sla_breach' AND a.resolved_at IS NULL
            AND au.id IN (b.owner_intake,b.owner_sales,b.owner_onboard,b.owner_ads))::int breaches,
       (SELECT count(*) FROM alerts a JOIN brands b ON b.id=a.brand_id
          WHERE a.kind='no_reply' AND a.resolved_at IS NULL
            AND au.id IN (b.owner_intake,b.owner_sales,b.owner_onboard,b.owner_ads))::int no_reply
      FROM admin_users au WHERE au.active ORDER BY au.name`);
}

/** 배정 로그 + owner 필드 갱신(재배치·인수인계 09-B-3). ops/assign 이 호출. */
export async function logAssignment(input: {
  brandId: string; role: string; fromUser: string | null; toUser: string; byUser: string; reason?: string;
}): Promise<void> {
  await query(
    `INSERT INTO assignment_log (brand_id, role, from_user, to_user, by_user, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.brandId, input.role, input.fromUser, input.toUser, input.byUser, input.reason ?? ""]);
}

/** 미배정 브랜드 큐 (09-B-2). */
export async function listUnassigned(role?: OwnerField): Promise<{ id: string; brand_name: string; state: string; category: string; grade: string | null }[]> {
  const roleFilter = role
    ? `${role} IS NULL`
    : `(owner_intake IS NULL OR owner_sales IS NULL OR owner_onboard IS NULL OR owner_ads IS NULL)`;
  return query(
    `SELECT id, brand_name, state, category, grade FROM brands
      WHERE state NOT IN ('dropped','churned') AND ${roleFilter}
      ORDER BY stage_entered_at ASC LIMIT 100`);
}
