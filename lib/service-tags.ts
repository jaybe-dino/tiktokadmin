// 운영중 서비스 트랙 태그 — <운영대행>(온보딩) · <마케팅대행>. 필수값 아님, 브랜드360에서 수동 토글 가능.
//   자동 활성화만 한다(비활성화는 하지 않음): 영업 파이프라인이 '운영중'이고
//   온보딩 신청서/마케팅 제안서가 해당 브랜드에 맵핑되면 각 태그를 true 로 켠다.
import { query, queryOne } from "./db";

const OPERATING_STATES = new Set(["live_mall", "live_onboarding", "settling"]);

export function isOperatingState(state: string): boolean {
  return OPERATING_STATES.has(state);
}

async function hasOnbMapping(brandId: string): Promise<boolean> {
  const r = await queryOne<{ x: number }>(
    `SELECT 1 AS x FROM onb_applications a
       LEFT JOIN onb_customers cu ON cu.id = a.customer_id
      WHERE COALESCE(a.brand_id, cu.brand_id) = $1 LIMIT 1`,
    [brandId],
  ).catch(() => null);
  return !!r;
}

async function hasMktProposalMapping(brandId: string): Promise<boolean> {
  const r = await queryOne<{ x: number }>(
    "SELECT 1 AS x FROM proposals WHERE brand_id=$1 AND kind='marketing' LIMIT 1",
    [brandId],
  ).catch(() => null);
  return !!r;
}

/** 브랜드가 운영중 + 매핑 존재 시 서비스 태그 자동 활성화. 상태전이·매핑 이벤트 후 호출(스키마 드리프트 시 조용히 무시). */
export async function syncServiceTags(brandId: string): Promise<void> {
  const b = await queryOne<{ state: string; tag_ops_agency: boolean | null; tag_mkt_agency: boolean | null }>(
    "SELECT state, tag_ops_agency, tag_mkt_agency FROM brands WHERE id=$1",
    [brandId],
  ).catch(() => null);
  if (!b || !isOperatingState(b.state)) return;

  const needOps = !b.tag_ops_agency;
  const needMkt = !b.tag_mkt_agency;
  if (!needOps && !needMkt) return;

  const [ops, mkt] = await Promise.all([
    needOps ? hasOnbMapping(brandId) : Promise.resolve(false),
    needMkt ? hasMktProposalMapping(brandId) : Promise.resolve(false),
  ]);
  if (!ops && !mkt) return;

  await query(
    `UPDATE brands SET tag_ops_agency = tag_ops_agency OR $2, tag_mkt_agency = tag_mkt_agency OR $3 WHERE id=$1`,
    [brandId, ops, mkt],
  ).catch(() => {});
}
