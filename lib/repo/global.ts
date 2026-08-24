// 크로스-브랜드 목록 쿼리 — 프로토타입 상단 독립 화면용.
import { query, queryOne } from "../db";

export interface Row { [k: string]: unknown }

// 제안서 (전 브랜드)
export function allProposals() {
  return query(`SELECT p.id, p.version, p.plan, p.countries, p.term,
      COALESCE(p.quote_amount,p.amount) AS amount, p.status, p.sent_at, p.created_at,
      b.brand_name, b.id AS brand_id, b.grade
     FROM proposals p JOIN brands b ON b.id=p.brand_id
    ORDER BY p.created_at DESC LIMIT 200`);
}

// 계약
export function allContracts() {
  return query(`SELECT c.id, c.kind, c.status, c.start_date, c.end_date, c.terms, c.signed_at,
      c.proposal_id, p.title AS proposal_title, p.amount AS proposal_amount,
      b.brand_name, b.id AS brand_id
     FROM contracts c JOIN brands b ON b.id=c.brand_id
     LEFT JOIN proposals p ON p.id = c.proposal_id
    ORDER BY c.created_at DESC LIMIT 200`);
}

// 미팅
export function allMeetings() {
  return query(`SELECT m.id, m.topic, m.status, m.followup_status, m.scheduled_at, m.started_at,
      b.brand_name, b.id AS brand_id
     FROM meetings m LEFT JOIN brands b ON b.id=m.brand_id
    ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC LIMIT 200`);
}

// 마케팅 프로젝트
export function allMktProjects() {
  // 연결된 마케팅 제안서(proposal_id)의 제목·금액·상태·파일까지 함께 — 카드 상세에서 관리.
  return query(`SELECT mp.id, mp.title, mp.kind, mp.proposal_status, mp.note, mp.proposal_id,
      b.brand_name, b.id AS brand_id, b.owner_ads,
      p.title AS prop_title, p.amount AS prop_amount, p.status AS prop_status, p.url AS prop_url,
      p.period_start::text AS prop_period_start, p.period_end::text AS prop_period_end
     FROM mkt_projects mp JOIN brands b ON b.id=mp.brand_id
     LEFT JOIN proposals p ON p.id = mp.proposal_id
    ORDER BY mp.updated_at DESC LIMIT 200`);
}

// 발송 센터
export function allBulkSends() {
  return query(`SELECT id, title, target_kind, channel, status, total, sent, created_at
     FROM bulk_sends ORDER BY created_at DESC LIMIT 100`);
}

// QnA
export function allQna() {
  return query(`SELECT id, question, answer, category, approved, usage_count
     FROM qna_entries ORDER BY usage_count DESC, created_at DESC LIMIT 200`);
}

// 제품·인증 (제품별 인증 롤업)
export function allProducts() {
  return query(`SELECT pm.id, pm.name_kr, pm.category, pm.status, pm.source, b.brand_name, b.id AS brand_id,
      count(pc.*)::int AS cert_total,
      count(pc.*) FILTER (WHERE pc.status='ready' AND (pc.expires_at IS NULL OR pc.expires_at >= current_date))::int AS cert_ready,
      count(pc.*) FILTER (WHERE pc.status IN ('expired','rejected','none'))::int AS cert_risk
     FROM products_master pm JOIN brands b ON b.id=pm.brand_id
     LEFT JOIN product_certs pc ON pc.product_id=pm.id
    GROUP BY pm.id, b.brand_name, b.id ORDER BY cert_risk DESC, pm.created_at DESC LIMIT 300`);
}

// 인증 리스크 (만료·미비)
export function certRisks() {
  return query(`SELECT pc.id, pm.name_kr AS product, b.brand_name, b.id AS brand_id, pc.country, pc.cert_type, pc.status, pc.expires_at
     FROM product_certs pc JOIN products_master pm ON pm.id=pc.product_id JOIN brands b ON b.id=pm.brand_id
    WHERE pc.status IN ('none','rejected','expired')
       OR (pc.expires_at IS NOT NULL AND pc.expires_at < current_date + interval '30 days')
    ORDER BY pc.expires_at NULLS FIRST LIMIT 100`);
}

// 자산
export function allAssets() {
  return query(`SELECT a.id, a.kind, a.filename, a.external_url, a.storage_url, a.source, a.created_at,
      b.brand_name, b.id AS brand_id
     FROM assets a LEFT JOIN brands b ON b.id=a.brand_id
    ORDER BY a.created_at DESC LIMIT 200`);
}

// 정산
export function allSettlements() {
  return query(`SELECT s.id, s.month, s.gmv, s.fee_pct, s.fee_amount, s.sub_amount, s.total, s.status, s.anomaly,
      b.brand_name, b.id AS brand_id
     FROM settlements s JOIN brands b ON b.id=s.brand_id
    ORDER BY s.month DESC, s.anomaly DESC LIMIT 200`);
}

// 결재함
export function allApprovals() {
  return query(`SELECT ar.id, ar.kind, ar.payload, ar.requested_by, ar.status, ar.created_at,
      b.brand_name, b.id AS brand_id
     FROM approval_requests ar LEFT JOIN brands b ON b.id=ar.brand_id
    ORDER BY CASE ar.status WHEN 'pending' THEN 0 ELSE 1 END, ar.created_at DESC LIMIT 200`);
}

// 상단 요약 카운트
export async function topCounts() {
  const r = await queryOne<Record<string, string>>(`SELECT
      (SELECT count(*) FROM proposals WHERE status='sent') sent_proposals,
      (SELECT count(*) FROM contracts WHERE status IN ('review','sent')) open_contracts,
      (SELECT count(*) FROM meetings WHERE status IN ('scheduled','received')) upcoming_meetings,
      (SELECT count(*) FROM approval_requests WHERE status='pending') pending_approvals,
      (SELECT count(*) FROM email_drafts WHERE status='draft') pending_drafts,
      (SELECT count(*) FROM settlements WHERE status='draft') draft_settlements`);
  return r ?? {};
}
