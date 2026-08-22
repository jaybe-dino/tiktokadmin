// 데이터 정합성 점검(읽기 전용) — 고아 레코드·끊긴 링크 스캔. 엔드포인트·인앱 카드 공용.
import { getPool } from "./db";

export interface IntegrityCheck { key: string; label: string; count: number | null; note?: string }
export interface IntegrityResult { healthy: boolean; issues: number; checks: IntegrityCheck[] }

// 각 점검: 부모가 사라진 자식 행(고아) 개수. 존재하지 않는 테이블/컬럼은 note 로 스킵(크래시 방지).
const CHECKS: { key: string; label: string; sql: string }[] = [
  { key: "proposals_orphan", label: "브랜드 없는 운영제안서", sql:
    "SELECT count(*)::int n FROM proposals p LEFT JOIN brands b ON b.id=p.brand_id WHERE p.brand_id IS NOT NULL AND b.id IS NULL" },
  { key: "mkt_proposal_docs_orphan", label: "브랜드 없는 마케팅제안서", sql:
    "SELECT count(*)::int n FROM mkt_proposal_docs d LEFT JOIN brands b ON b.id=d.brand_id WHERE d.brand_id IS NOT NULL AND b.id IS NULL" },
  { key: "mkt_projects_orphan", label: "브랜드 없는 마케팅프로젝트", sql:
    "SELECT count(*)::int n FROM mkt_projects m LEFT JOIN brands b ON b.id=m.brand_id WHERE m.brand_id IS NOT NULL AND b.id IS NULL" },
  { key: "assets_orphan", label: "브랜드 없는 자산", sql:
    "SELECT count(*)::int n FROM assets a LEFT JOIN brands b ON b.id=a.brand_id WHERE a.brand_id IS NOT NULL AND b.id IS NULL" },
  { key: "contacts_orphan", label: "브랜드 없는 담당자", sql:
    "SELECT count(*)::int n FROM brand_contacts c LEFT JOIN brands b ON b.id=c.brand_id WHERE b.id IS NULL" },
  { key: "meetings_orphan", label: "브랜드 없는 미팅", sql:
    "SELECT count(*)::int n FROM meetings m LEFT JOIN brands b ON b.id=m.brand_id WHERE m.brand_id IS NOT NULL AND b.id IS NULL" },
  { key: "dropped_open_alerts", label: "드랍된 브랜드에 남은 미해결 알림", sql:
    "SELECT count(*)::int n FROM alerts a JOIN brands b ON b.id=a.brand_id WHERE b.state IN ('dropped','churned') AND a.resolved_at IS NULL" },
  { key: "brands_no_owner_active", label: "담당자 미배정 진행중 브랜드", sql:
    "SELECT count(*)::int n FROM brands WHERE state NOT IN ('lead_new','dropped','churned') AND owner_sales IS NULL AND owner_intake IS NULL" },
];

export async function runIntegrityChecks(): Promise<IntegrityResult> {
  const client = await getPool().connect();
  const checks: IntegrityCheck[] = [];
  try {
    for (const c of CHECKS) {
      try {
        const { rows } = await client.query<{ n: number }>(c.sql);
        checks.push({ key: c.key, label: c.label, count: rows[0]?.n ?? 0 });
      } catch (e) {
        checks.push({ key: c.key, label: c.label, count: null, note: (e as Error).message.slice(0, 120) });
      }
    }
  } finally {
    client.release();
  }
  const issues = checks.filter((r) => (r.count ?? 0) > 0).length;
  return { healthy: issues === 0, issues, checks };
}
