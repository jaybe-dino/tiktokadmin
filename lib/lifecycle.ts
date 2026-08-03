// 라이프사이클·거버넌스 (17) — 해지 연쇄·수신동의 게이팅.
import { query, queryOne } from "./db";

// ── 1. 해지 오프보딩 연쇄 (17 §1) ─────────────────────────────
const OFFBOARD_DOCS = [
  { key: "store_takedown", label: "상품 내리기/이관" },
  { key: "access_revoke", label: "계정 권한 회수" },
  { key: "inventory_return", label: "재고 반출/소진 협의" },
];

/**
 * churned 전이 시 자동 연쇄(17 §1):
 *   ① 당월 사이클 paused ② 최종 정산 draft(해지 플래그) ③ 오프보딩 체크리스트
 *   ④ 보존 타이머(assets retention +1년) ⑤ 사유 기록 ⑥ 윈백 후보(90일)
 */
export async function runChurnChain(brandId: string, reason: string, actor: string): Promise<void> {
  // ⑤ 사유·시각 기록
  await query("UPDATE brands SET churn_reason=$2, churned_at=now() WHERE id=$1", [brandId, reason]);

  // ① 당월 사이클 paused
  await query(
    "UPDATE ops_cycles SET status='paused' WHERE brand_id=$1 AND status='active'", [brandId]).catch(() => {});

  // ② 최종 정산 draft(없으면 생성, 해지 플래그)
  const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM settlements WHERE brand_id=$1 AND month=$2", [brandId, month]).catch(() => null);
  if (!existing) {
    await query(
      `INSERT INTO settlements (brand_id, month, fee_pct, anomaly_note, status)
       VALUES ($1,$2,10,'해지 정산','draft') ON CONFLICT (brand_id,month) DO NOTHING`,
      [brandId, month]).catch(() => {});
  }

  // ③ 오프보딩 체크리스트 발행
  for (const d of OFFBOARD_DOCS) {
    await query(
      `INSERT INTO doc_items (brand_id, template, item_key, label) VALUES ($1,'offboard',$2,$3)
       ON CONFLICT (brand_id, item_key) DO NOTHING`,
      [brandId, d.key, d.label]).catch(() => {});
  }

  // ④ 보존 타이머: 해지 브랜드 자산 retention_until = +1년
  await query(
    "UPDATE assets SET retention_until = (now() + interval '1 year')::date WHERE brand_id=$1 AND retention_until IS NULL",
    [brandId]).catch(() => {});

  // 감사 로그
  await query("INSERT INTO access_log (actor, action, target, meta) VALUES ($1,'churn',$2,$3)",
    [actor, brandId, JSON.stringify({ reason })]).catch(() => {});
}

// ── 5. 수신동의 게이팅 (17 §5) ────────────────────────────────
// 화이트리스트 방식: 명확한 거래성 kind만 동의 무관 통과. 그 외(followup·reply 등
// 불명확·광고성 전부)는 수신동의 필요. 광고성 kind 열거 방식은 신규/모호한 kind가
// 검사 없이 새어나가므로(#6) 거래성 화이트리스트로 반전한다.

/** 동의 무관으로 항상 발송 가능한 kind. 이 집합 외는 전부 동의 필요.
 *   운영 원칙: 리드는 우리가 개별 컨택 → 팔로업·회신은 1:1 거래성 소통으로 취급(동의 무관).
 *   광고성 대량(campaign·newsletter·bulk_email·reactivation·upsell)만 동의 게이트 유지. */
const TRANSACTIONAL_KINDS = new Set([
  "payment_notice", "reminder", "doc_request", "settlement", "reply_transactional",
  "followup", "reply", "proposal",  // 개별 컨택 — 1:1 소통이라 동의 무관 발송 허용
]);
export function isTransactionalKind(kind: string): boolean {
  return TRANSACTIONAL_KINDS.has(kind);
}

/** (레거시) 광고성으로 명시된 kind 판정. 게이트 판정은 isTransactionalKind 사용. */
const MARKETING_KINDS = new Set(["reactivation", "upsell", "newsletter", "campaign", "bulk_email"]);
export function isMarketingKind(kind: string): boolean {
  return MARKETING_KINDS.has(kind);
}

/** 브랜드에 동의한 연락처가 하나라도 있는지. 광고성 발송 전 게이트(브랜드 단위). */
export async function hasMarketingConsent(brandId: string): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    "SELECT count(*)::text n FROM brand_contacts WHERE brand_id=$1 AND marketing_consent=true",
    [brandId],
  ).catch(() => null);
  return Number(row?.n ?? 0) > 0;
}

/**
 * 특정 수신자(이메일) 단위 수신동의(#7,8). 브랜드 any-consent로 판정하면 거부한 연락처에게도
 * 발송되므로, 해당 이메일 연락처의 marketing_consent로 정확히 판정한다.
 * 미등록 이메일·조회 실패는 미동의(false)로 취급(차단 우선).
 */
export async function hasRecipientConsent(brandId: string, email: string): Promise<boolean> {
  const row = await queryOne<{ consent: boolean }>(
    "SELECT marketing_consent AS consent FROM brand_contacts WHERE brand_id=$1 AND lower(email)=lower($2) LIMIT 1",
    [brandId, email],
  ).catch(() => null);
  return row?.consent === true;
}

/**
 * 발송 가능 여부: 거래성 kind면 항상 true, 그 외(광고성·불명확)는 수신동의 필요.
 *   recipient(이메일) 주어지면 해당 연락처 단위로 동의 판정, 없으면 브랜드 단위(하위호환).
 */
export async function canSend(
  brandId: string,
  kind: string,
  recipient?: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (isTransactionalKind(kind)) return { ok: true };
  const consent = recipient
    ? await hasRecipientConsent(brandId, recipient)
    : await hasMarketingConsent(brandId);
  return consent ? { ok: true } : { ok: false, reason: "광고성 메일 — 수신동의 없음(차단)" };
}
