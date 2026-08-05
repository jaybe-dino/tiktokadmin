// Phase 2 고객카드 심화 repo — 회사·연락처·제품·인증·제안·계약·자산·설문·재고·물류·QnA·마케팅.
//   읽기 전용 조회 + 기본 upsert. 상태전이/발송 쓰기는 /api/ops 게이트 경유(여기 아님).
import { query, queryOne } from "../db";

// ── 자산 (10-E) ────────────────────────────────────────────────
export interface Asset {
  id: string; brand_id: string | null; kind: string;
  filename: string; mime: string | null; size_bytes: number | null;
  storage_url: string | null; external_url: string | null;
  source: string; source_ref: string | null; uploaded_by: string | null;
  retention_until: string | null; created_at: string;
}
export function listAssets(brandId: string, kind?: string): Promise<Asset[]> {
  return kind
    ? query<Asset>("SELECT * FROM assets WHERE brand_id=$1 AND kind=$2 ORDER BY created_at DESC", [brandId, kind])
    : query<Asset>("SELECT * FROM assets WHERE brand_id=$1 ORDER BY kind, created_at DESC", [brandId]);
}
export async function addAsset(a: {
  brand_id: string; kind: string; filename: string; external_url?: string; storage_url?: string;
  mime?: string; source?: string; source_ref?: string; by?: string;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO assets (brand_id, kind, filename, mime, storage_url, external_url, source, source_ref, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [a.brand_id, a.kind, a.filename, a.mime ?? null, a.storage_url ?? null,
     a.external_url ?? null, a.source ?? "admin", a.source_ref ?? null, a.by ?? null],
  );
  return row!.id;
}

// ── 회사정보 (10-A) ────────────────────────────────────────────
export interface BrandCompany {
  brand_id: string;
  company_name_kr: string | null; company_name_en: string | null; company_type: string | null;
  rep_name: string | null; reg_date: string | null; biz_category: string | null;
  address_kr: string | null; address_en: string | null;
  biz_cert_asset_id: string | null; biz_verified: boolean;
  tax_email: string | null; tax_contact_name: string | null; tax_contact_phone: string | null;
  tax_cycle: string | null; tax_note: string | null;
  bank_name: string | null; bank_holder: string | null; bank_account: string | null;
  bank_cert_asset_id: string | null; bank_verified: boolean;
  brand_name_en: string | null; logo_asset_id: string | null;
  channel_urls: Record<string, string>; source: string | null;
  source_url: string | null; updated_at: string;
  // ── 온보딩(0037) 매핑 필드 ──
  company_country: string | null; company_reg_number: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  op_address_en: string | null; shop_name_kr: string | null; shop_name_en: string | null;
  product_category: string | null; sales_channel_url: string | null; brand_logo_url: string | null;
  doc_biz_reg_en_url: string | null; doc_biz_reg_kr_url: string | null; doc_corp_reg_kr_url: string | null;
  doc_ownership_url: string | null; doc_logistics_url: string | null;
  ubo_full_name: string | null; ubo_title: string | null; ubo_birth: string | null; ubo_country: string | null;
  ubo_id_type: string | null; ubo_id_number: string | null;
  ubo_id_front_url: string | null; ubo_id_back_url: string | null; ubo_address_proof_url: string | null;
  ownership_structure: string | null;
  auth_type: string | null; auth_name: string | null; auth_birth: string | null; auth_country: string | null;
  auth_id_type: string | null; auth_id_number: string | null; auth_email: string | null;
  auth_id_front_url: string | null; auth_id_back_url: string | null; auth_address_proof_url: string | null; auth_loa_url: string | null;
  pep_q1: string | null; pep_q2: string | null;
  ubo_signature_data: string | null; ubo_signed_at: string | null;
  payoneer_status: string | null; payoneer_email: string | null; payoneer_note: string | null;
  directors_json: { name?: string; is_ubo?: boolean; country?: string; birth?: string; id_type?: string; id_number?: string }[] | null;
  onb_application_id: string | null; onb_synced_at: string | null;
}
export function getCompany(brandId: string): Promise<BrandCompany | null> {
  return queryOne<BrandCompany>("SELECT * FROM brand_company WHERE brand_id=$1", [brandId]);
}
export async function upsertCompany(brandId: string, patch: Partial<BrandCompany>): Promise<void> {
  // 허용 컬럼만 동적 UPSERT.
  const cols = [
    "company_name_kr","company_name_en","company_type","rep_name","reg_date","biz_category",
    "address_kr","address_en","biz_verified","tax_email","tax_contact_name","tax_contact_phone",
    "tax_cycle","tax_note","bank_name","bank_holder","bank_account","bank_verified",
    "brand_name_en","channel_urls","source","source_url",
    // 온보딩(0037) 관리 필드 — 원장에서 직접 편집 허용.
    "company_country","company_reg_number","contact_name","contact_email","contact_phone",
    "op_address_en","shop_name_kr","shop_name_en","product_category","sales_channel_url","brand_logo_url",
    "doc_biz_reg_en_url","doc_biz_reg_kr_url","doc_corp_reg_kr_url","doc_ownership_url","doc_logistics_url",
    "ubo_full_name","ubo_title","ubo_birth","ubo_country","ubo_id_type","ubo_id_number",
    "ubo_id_front_url","ubo_id_back_url","ubo_address_proof_url","ownership_structure",
    "auth_type","auth_name","auth_birth","auth_country","auth_id_type","auth_id_number","auth_email",
    "auth_id_front_url","auth_id_back_url","auth_address_proof_url","auth_loa_url",
    "pep_q1","pep_q2","payoneer_status","payoneer_email","payoneer_note",
  ] as const;
  const set = cols.filter((c) => c in patch);
  if (set.length === 0) {
    await query("INSERT INTO brand_company (brand_id) VALUES ($1) ON CONFLICT (brand_id) DO NOTHING", [brandId]);
    return;
  }
  const vals: unknown[] = [brandId];
  const insCols = ["brand_id", ...set];
  const insPlace = insCols.map((_, i) => `$${i + 1}`);
  for (const c of set) {
    const v = (patch as Record<string, unknown>)[c];
    vals.push(c === "channel_urls" ? JSON.stringify(v ?? {}) : v);
  }
  const upd = set.map((c) => `${c}=EXCLUDED.${c}`).join(", ");
  await query(
    `INSERT INTO brand_company (${insCols.join(",")}) VALUES (${insPlace.join(",")})
     ON CONFLICT (brand_id) DO UPDATE SET ${upd}, updated_at=now()`,
    vals,
  );
}

// ── 연락처 인물 (14-B) ─────────────────────────────────────────
export interface BrandContact {
  id: string; brand_id: string; name: string; title: string;
  email: string | null; phone: string | null; role: string;
  is_primary: boolean; note: string; created_at: string;
  marketing_consent: boolean | null;  // null=미확인
}
export function listContacts(brandId: string): Promise<BrandContact[]> {
  return query<BrandContact>(
    "SELECT * FROM brand_contacts WHERE brand_id=$1 ORDER BY is_primary DESC, created_at", [brandId]);
}
export async function addContact(c: {
  brand_id: string; name: string; title?: string; email?: string; phone?: string;
  role?: string; is_primary?: boolean; note?: string;
}): Promise<void> {
  await query(
    `INSERT INTO brand_contacts (brand_id, name, title, email, phone, role, is_primary, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [c.brand_id, c.name, c.title ?? "", c.email ?? null, c.phone ?? null,
     c.role ?? "main", c.is_primary ?? false, c.note ?? ""],
  );
  if (c.is_primary) await syncPrimaryContact(c.brand_id);
}
export async function deleteContact(id: string): Promise<void> {
  await query("DELETE FROM brand_contacts WHERE id=$1", [id]);
}
/** is_primary 인물을 brands.contact_name/email/phone 에 동기(14-B). */
export async function syncPrimaryContact(brandId: string): Promise<void> {
  const p = await queryOne<BrandContact>(
    "SELECT * FROM brand_contacts WHERE brand_id=$1 AND is_primary ORDER BY created_at LIMIT 1", [brandId]);
  if (!p) return;
  await query(
    "UPDATE brands SET contact_name=COALESCE(NULLIF($2,''),contact_name), email=COALESCE($3,email), phone=COALESCE($4,phone) WHERE id=$1",
    [brandId, p.name, p.email, p.phone]);
}

// ── 제품 + 인증 (10-B, 10-I-2) ─────────────────────────────────
export interface Product {
  id: string; brand_id: string; name_kr: string; name_en: string;
  category: string; sku: string; price_band: string; main_image_url: string;
  status: string; source: string; source_ref: string | null; created_at: string;
}
export interface ProductCert {
  id: string; product_id: string; country: string; cert_type: string;
  status: string; cert_number: string; issued_at: string | null; expires_at: string | null;
  asset_id: string | null; note: string; updated_at: string;
}
export function listProducts(brandId: string): Promise<Product[]> {
  return query<Product>("SELECT * FROM products_master WHERE brand_id=$1 ORDER BY created_at", [brandId]);
}
export function listCertsForBrand(brandId: string): Promise<(ProductCert & { product_name: string })[]> {
  return query<ProductCert & { product_name: string }>(
    `SELECT pc.*, pm.name_kr AS product_name
       FROM product_certs pc JOIN products_master pm ON pm.id=pc.product_id
      WHERE pm.brand_id=$1 ORDER BY pm.name_kr, pc.country, pc.cert_type`, [brandId]);
}
export async function addProduct(p: {
  brand_id: string; name_kr: string; name_en?: string; category?: string; sku?: string;
  price_band?: string; status?: string; source?: string;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO products_master (brand_id, name_kr, name_en, category, sku, price_band, status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [p.brand_id, p.name_kr, p.name_en ?? "", p.category ?? "", p.sku ?? "",
     p.price_band ?? "", p.status ?? "active", p.source ?? "manual"]);
  return row!.id;
}
// 인증국 라벨(한글) → 국가코드. brand_company/설문과 달리 product_certs.country 는 코드 사용.
const CERT_COUNTRY_LABEL_TO_CODE: Record<string, string> = {
  미국: "US", 베트남: "VN", 태국: "TH", 싱가포르: "SG", 필리핀: "PH", 말레이시아: "MY",
};
const CERT_COUNTRY_CODES = new Set(["US", "VN", "TH", "SG", "PH", "MY"]);
/** 인증국 정규화(#5): 한글 라벨→코드, 소문자 코드→대문자. 미매칭은 원본 유지. */
export function normalizeCountryCode(country: string): string {
  const c = (country ?? "").trim();
  if (CERT_COUNTRY_LABEL_TO_CODE[c]) return CERT_COUNTRY_LABEL_TO_CODE[c];
  const up = c.toUpperCase();
  return CERT_COUNTRY_CODES.has(up) ? up : c;
}
export async function upsertCert(c: {
  product_id: string; country: string; cert_type: string; status?: string;
  cert_number?: string; issued_at?: string | null; expires_at?: string | null; note?: string;
}): Promise<void> {
  const country = normalizeCountryCode(c.country);
  await query(
    `INSERT INTO product_certs (product_id, country, cert_type, status, cert_number, issued_at, expires_at, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (product_id, country, cert_type) DO UPDATE SET
       status=EXCLUDED.status, cert_number=EXCLUDED.cert_number,
       issued_at=EXCLUDED.issued_at, expires_at=EXCLUDED.expires_at,
       note=EXCLUDED.note, updated_at=now()`,
    [c.product_id, country, c.cert_type, c.status ?? "none", c.cert_number ?? "",
     c.issued_at ?? null, c.expires_at ?? null, c.note ?? ""]);
}

// ── 제안 v2 (10-C) ─────────────────────────────────────────────
export interface ProposalV2 {
  id: string; brand_id: string; version: number; title: string | null; url: string;
  plan: string | null; countries: string[]; term: string; quote_amount: number | null;
  amount: number | null; discount_note: string; status: string;
  sent_at: string | null; decided_at: string | null; asset_id: string | null;
  note: string; created_by: string | null; created_at: string;
}
export function listProposalsV2(brandId: string): Promise<ProposalV2[]> {
  return query<ProposalV2>("SELECT * FROM proposals WHERE brand_id=$1 ORDER BY version DESC, created_at DESC", [brandId]);
}
export async function addProposalV2(p: {
  brand_id: string; plan: string; countries: string[]; term: string;
  quote_amount: number; title?: string; discount_note?: string; by?: string;
}): Promise<string> {
  const verRow = await queryOne<{ v: number }>(
    "SELECT COALESCE(max(version),0)+1 AS v FROM proposals WHERE brand_id=$1", [p.brand_id]);
  const version = verRow?.v ?? 1;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO proposals (brand_id, version, title, plan, countries, term, quote_amount, amount, discount_note, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,'draft',$9) RETURNING id`,
    [p.brand_id, version, p.title ?? `제안 v${version}`, p.plan, p.countries, p.term,
     p.quote_amount, p.discount_note ?? "", p.by ?? null]);
  return row!.id;
}
/** 제안 상태 변경 + 타임스탬프 자동기록(#16). sent→sent_at, accepted/rejected→decided_at. */
export async function setProposalV2Status(id: string, status: string): Promise<void> {
  const stamp =
    status === "sent" ? ", sent_at=now()"
    : status === "accepted" || status === "rejected" ? ", decided_at=now()"
    : "";
  await query(`UPDATE proposals SET status=$2${stamp} WHERE id=$1`, [id, status]);
}

// ── 계약 (10-D) ────────────────────────────────────────────────
export interface Contract {
  id: string; brand_id: string; kind: string; version: number; status: string;
  start_date: string | null; end_date: string | null; signed_at: string | null;
  terms: Record<string, unknown>; asset_id: string | null; esign_ref: string;
  note: string; created_at: string;
}
export function listContracts(brandId: string): Promise<Contract[]> {
  return query<Contract>("SELECT * FROM contracts WHERE brand_id=$1 ORDER BY created_at DESC", [brandId]);
}
export async function addContract(c: {
  brand_id: string; kind: string; terms: Record<string, unknown>;
  start_date?: string | null; end_date?: string | null; status?: string; note?: string;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO contracts (brand_id, kind, terms, start_date, end_date, status, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [c.brand_id, c.kind, JSON.stringify(c.terms ?? {}), c.start_date ?? null,
     c.end_date ?? null, c.status ?? "draft", c.note ?? ""]);
  return row!.id;
}
export async function setContractStatus(id: string, status: string): Promise<void> {
  const signedAt = status === "signed" ? ", signed_at=now()" : "";
  await query(`UPDATE contracts SET status=$2${signedAt} WHERE id=$1`, [id, status]);
}

// ── 설문 (14-A) ────────────────────────────────────────────────
export interface Survey {
  id: string; brand_id: string; kind: string; token: string;
  sent_at: string | null; responded_at: string | null;
  answers: Record<string, unknown>; created_at: string;
}
export function listSurveys(brandId: string): Promise<Survey[]> {
  return query<Survey>("SELECT * FROM surveys WHERE brand_id=$1 ORDER BY created_at DESC", [brandId]);
}
export function getSurveyByToken(token: string): Promise<(Survey & { brand_name: string }) | null> {
  return queryOne<Survey & { brand_name: string }>(
    `SELECT s.*, b.brand_name FROM surveys s JOIN brands b ON b.id=s.brand_id WHERE s.token=$1`, [token]);
}
/** 설문 생성 → 토큰 반환(공개 링크 /s/{token}). 미팅 팔로업(08)에서 호출. */
export async function createSurvey(brandId: string, kind = "post_meeting"): Promise<string> {
  const token = randomToken();
  await query(
    "INSERT INTO surveys (brand_id, kind, token, sent_at) VALUES ($1,$2,$3,now())",
    [brandId, kind, token]);
  return token;
}
/** 공개 응답 저장 → brands 반영(목표국) + 응답시각. 소프트 게이트용 표시. */
export async function submitSurveyResponse(token: string, answers: Record<string, unknown>): Promise<boolean> {
  const s = await queryOne<{ id: string; brand_id: string; responded_at: string | null }>(
    "SELECT id, brand_id, responded_at FROM surveys WHERE token=$1", [token]);
  if (!s) return false;
  if (s.responded_at) return false; // 재제출 방지(#24) — 이미 응답 완료.
  // 원자적 가드: 동시 재제출 시에도 최초 1건만 저장(0행이면 이미 응답됨).
  const saved = await query<{ id: string }>(
    "UPDATE surveys SET answers=$2, responded_at=now() WHERE token=$1 AND responded_at IS NULL RETURNING id",
    [token, JSON.stringify(answers)]);
  if (saved.length === 0) return false;
  // 목표국이 응답에 있으면 brands.countries 보강(덮어쓰기 아님 — 병합).
  const tc = answers.target_countries;
  if (Array.isArray(tc) && tc.length > 0) {
    await query(
      "UPDATE brands SET countries=(SELECT array_agg(DISTINCT c) FROM unnest(countries || $2::text[]) c) WHERE id=$1",
      [s.brand_id, tc as string[]]).catch((e) => console.error("[survey] 목표국 병합 실패", e));
  }
  // 마케팅 수신 동의 전파(#7): 대표(is_primary) 연락처에 반영. 대표 없으면 0행 → 스킵.
  const mc = answers.marketing_consent;
  if (typeof mc === "boolean") {
    await query(
      "UPDATE brand_contacts SET marketing_consent=$2, consent_at=now() WHERE brand_id=$1 AND is_primary",
      [s.brand_id, mc]).catch((e) => console.error("[survey] 마케팅 동의 전파 실패", e));
  }
  return true;
}
function randomToken(): string {
  return "sv_" + globalThis.crypto.randomUUID().replace(/-/g, "");
}

// ── 재고 입고 (14-C) ───────────────────────────────────────────
export interface InventoryIntake {
  id: string; brand_id: string; product_id: string | null; country: string;
  warehouse_id: string | null; qty: number; unit_cost: number | null; status: string;
  tracking_no: string; shipped_at: string | null; arrived_at: string | null;
  note: string; created_at: string;
}
export function listInventory(brandId: string): Promise<(InventoryIntake & { product_name: string | null })[]> {
  return query<InventoryIntake & { product_name: string | null }>(
    `SELECT i.*, pm.name_kr AS product_name FROM inventory_intakes i
       LEFT JOIN products_master pm ON pm.id=i.product_id
      WHERE i.brand_id=$1 ORDER BY i.country, i.created_at DESC`, [brandId]);
}

// ── 물류 계약 (14-D) ───────────────────────────────────────────
export interface LogisticsContract {
  id: string; brand_id: string; country: string; provider: string;
  warehouse_region: string; contact: string; phone: string; address: string;
  status: string; contract_asset_id: string | null;
  start_date: string | null; end_date: string | null; apply_warehouse_id: number | null;
  note: string; created_at: string;
}
export function listLogistics(brandId: string): Promise<LogisticsContract[]> {
  return query<LogisticsContract>("SELECT * FROM logistics_contracts WHERE brand_id=$1 ORDER BY country", [brandId]);
}
export async function upsertLogistics(l: {
  brand_id: string; country: string; provider?: string; status?: string;
  warehouse_region?: string; contact?: string; phone?: string; address?: string;
  start_date?: string | null; end_date?: string | null; note?: string;
}): Promise<void> {
  await query(
    `INSERT INTO logistics_contracts (brand_id, country, provider, status, warehouse_region, contact, phone, address, start_date, end_date, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [l.brand_id, l.country, l.provider ?? "", l.status ?? "none", l.warehouse_region ?? "",
     l.contact ?? "", l.phone ?? "", l.address ?? "", l.start_date ?? null, l.end_date ?? null, l.note ?? ""]);
}

// ── 마케팅 프로젝트 (10-I-1) ───────────────────────────────────
export interface MktProject {
  id: string; brand_id: string; kind: string; title: string;
  rfp_asset_id: string | null; rfp_summary: string | null;
  proposal_asset_id: string | null; proposal_status: string;
  contract_id: string | null; owner_admin_id: string | null; note: string | null;
  created_at: string; updated_at: string;
}
export function listMktProjects(brandId: string): Promise<MktProject[]> {
  return query<MktProject>("SELECT * FROM mkt_projects WHERE brand_id=$1 ORDER BY updated_at DESC", [brandId]);
}

// ── 카드 심화 통합 조회 (360 탭용) ─────────────────────────────
export interface MeetingLite {
  id: string; topic: string; status: string; followup_status: string;
  scheduled_at: string | null; started_at: string | null; summary_md: string | null; created_at: string;
}
export function listMeetingsLite(brandId: string): Promise<MeetingLite[]> {
  return query<MeetingLite>(
    "SELECT id, topic, status, followup_status, scheduled_at, started_at, summary_md, created_at FROM meetings WHERE brand_id=$1 ORDER BY created_at DESC", [brandId]);
}

export interface CardDeep {
  company: BrandCompany | null;
  contacts: BrandContact[];
  products: Product[];
  certs: (ProductCert & { product_name: string })[];
  proposals: ProposalV2[];
  contracts: Contract[];
  assets: Asset[];
  surveys: Survey[];
  inventory: (InventoryIntake & { product_name: string | null })[];
  logistics: LogisticsContract[];
  mktProjects: MktProject[];
  meetings: MeetingLite[];
}
export async function cardDeep(brandId: string): Promise<CardDeep> {
  const safe = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
  const [company, contacts, products, certs, proposals, contracts, assets, surveys, inventory, logistics, mktProjects, meetings] =
    await Promise.all([
      getCompany(brandId).catch(() => null),
      safe(listContacts(brandId)),
      safe(listProducts(brandId)),
      safe(listCertsForBrand(brandId)),
      safe(listProposalsV2(brandId)),
      safe(listContracts(brandId)),
      safe(listAssets(brandId)),
      safe(listSurveys(brandId)),
      safe(listInventory(brandId)),
      safe(listLogistics(brandId)),
      safe(listMktProjects(brandId)),
      safe(listMeetingsLite(brandId)),
    ]);
  return { company, contacts, products, certs, proposals, contracts, assets, surveys, inventory, logistics, mktProjects, meetings };
}
