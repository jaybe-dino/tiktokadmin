// 고객 온보딩 포털 — 이메일+발급코드 로그인 + 4스텝 KYC 신청서.
//   인증: scrypt(lib/auth) 재사용 · 세션: HMAC 서명 쿠키(onb_session).
//   승인 시 brand_company/products 자동 매핑(approveApplication).
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "./db";
import { env } from "./env";
import { hashPassword, verifyPassword } from "./auth";

const COOKIE = "onb_session";

// ── 세션 서명(어드민 세션과 동일 방식, 별도 쿠키) ──
function sign(id: string): string {
  return createHmac("sha256", env.sessionSecret).update("onb:" + id).digest("hex");
}
export function makeOnbSession(customerId: string): string {
  return `${Buffer.from(customerId).toString("base64url")}.${sign(customerId)}`;
}
export function verifyOnbSession(value: string): string | null {
  const [b64, sig] = (value || "").split(".");
  if (!b64 || !sig) return null;
  let id: string;
  try { id = Buffer.from(b64, "base64url").toString("utf8"); } catch { return null; }
  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

export interface OnbCustomer { id: string; email: string; brand_id: string | null; note: string; active: boolean }

/** 관리자: 고객 계정 발급(이메일+8자리 코드). 기존 이메일이면 코드 재발급. 코드는 1회 반환. */
export async function issueCustomer(email: string, brandId: string | null, note: string, by: string): Promise<{ ok: boolean; code?: string; error?: string }> {
  const e = (email || "").trim().toLowerCase();
  if (!e.includes("@")) return { ok: false, error: "이메일 형식이 아닙니다." };
  // 8자리 영숫자 코드(혼동 문자 0/O/1/I/L 제외).
  const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const buf = randomBytes(8);
  const code = Array.from(buf, (b) => ALPHABET[b % ALPHABET.length]).join("");
  try {
    await query(
      `INSERT INTO onb_customers (email, access_code_hash, brand_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO UPDATE SET access_code_hash=EXCLUDED.access_code_hash,
         brand_id=COALESCE(EXCLUDED.brand_id, onb_customers.brand_id), note=EXCLUDED.note, active=true`,
      [e, hashPassword(code), brandId, note || "", by]);
    return { ok: true, code };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "발급 실패" };
  }
}

/** 고객 로그인 검증 → 성공 시 customerId. */
export async function verifyOnbLogin(email: string, code: string): Promise<{ ok: boolean; customerId?: string; error?: string }> {
  const e = (email || "").trim().toLowerCase();
  const c = await queryOne<{ id: string; access_code_hash: string; active: boolean }>(
    "SELECT id, access_code_hash, active FROM onb_customers WHERE email=$1", [e]).catch(() => null);
  if (!c) return { ok: false, error: "등록되지 않은 이메일입니다. 담당자에게 문의하세요." };
  if (!c.active) return { ok: false, error: "비활성 계정입니다." };
  if (!verifyPassword((code || "").trim(), c.access_code_hash)) return { ok: false, error: "코드가 올바르지 않습니다." };
  await query("UPDATE onb_customers SET last_login_at=now() WHERE id=$1", [c.id]).catch(() => {});
  return { ok: true, customerId: c.id };
}

/** 현재 세션 고객(쿠키). */
export async function currentOnbCustomer(): Promise<OnbCustomer | null> {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return null;
  const id = verifyOnbSession(v);
  if (!id) return null;
  const c = await queryOne<OnbCustomer>("SELECT id, email, brand_id, note, active FROM onb_customers WHERE id=$1 AND active", [id]).catch(() => null);
  return c ?? null;
}

export const ONB_COOKIE = COOKIE;

// ── 신청서 ──
export interface OnbStep { step_no: number; status: string; admin_feedback: string }

// tpartners 5스텝 정의 + 초기 잠금(1·2·5 열림, 3·4 잠금).
export const STEP_DEFS: [number, string, string][] = [
  [1, "기본신청", "회사/담당자/브랜드/서류/희망국가"],
  [2, "수권서 서명", "LOA 자동 생성 및 서명"],
  [3, "회사 추가정보", "지분구조/대표자 여권·신분증·거주지증명/Payoneer"],
  [4, "제품 등록", "국가별 단가·인증·상세페이지 번역"],
  [5, "물류 계약서", "국가별 물류 계약서 (미국은 FBA 캡처 가능)"],
];
const INITIAL_STATUS: Record<number, string> = { 1: "unlocked", 2: "unlocked", 3: "locked", 4: "locked", 5: "unlocked" };

/** 고객의 신청서 확보(없으면 생성 + 5스텝 초기화). 1·2·5 열림, 3·4 잠금. */
export async function getOrCreateApplication(customerId: string, brandId: string | null): Promise<{ id: string }> {
  const found = await queryOne<{ id: string }>("SELECT id FROM onb_applications WHERE customer_id=$1", [customerId]).catch(() => null);
  if (found) {
    // 기존(4스텝) 신청서에 5스텝 누락분 보정.
    for (const [n] of STEP_DEFS) {
      await query("INSERT INTO onb_steps (application_id, step_no, status, unlocked_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [found.id, n, INITIAL_STATUS[n], INITIAL_STATUS[n] === "unlocked" ? new Date().toISOString() : null]).catch(() => {});
    }
    return found;
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO onb_applications (customer_id, brand_id, status) VALUES ($1,$2,'draft') RETURNING id`,
    [customerId, brandId]);
  const id = row!.id;
  const nowIso = new Date().toISOString();
  for (const [n] of STEP_DEFS) {
    await query("INSERT INTO onb_steps (application_id, step_no, status, unlocked_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [id, n, INITIAL_STATUS[n], INITIAL_STATUS[n] === "unlocked" ? nowIso : null]).catch(() => {});
  }
  return { id };
}

export async function getApplicationById(id: string): Promise<Record<string, unknown> | null> {
  return queryOne("SELECT * FROM onb_applications WHERE id=$1", [id]).catch(() => null);
}
export async function getApplicationByCustomer(customerId: string): Promise<Record<string, unknown> | null> {
  return queryOne("SELECT * FROM onb_applications WHERE customer_id=$1", [customerId]).catch(() => null);
}
export async function getSteps(applicationId: string): Promise<OnbStep[]> {
  return query<OnbStep>("SELECT step_no, status, admin_feedback FROM onb_steps WHERE application_id=$1 ORDER BY step_no", [applicationId]).catch(() => []);
}

// 스텝별 저장 가능한 컬럼 화이트리스트(tpartners 5스텝 정합, 고객 입력 대상만).
const STEP_FIELDS: Record<number, string[]> = {
  // 1 기본신청 — 회사·담당자·주소·브랜드&대표자(성명/직책)·서류 URL (국가매트릭스는 별도)
  1: ["company_name_kr", "company_name_en", "company_type", "company_country", "company_reg_date", "company_reg_number",
      "contact_name", "contact_email", "contact_phone", "address_kr", "address_en", "op_address_en",
      "shop_name_kr", "shop_name_en", "product_category", "sales_channel_url", "brand_logo_url",
      "ubo_full_name", "ubo_title",
      "doc_biz_reg_en_url", "doc_biz_reg_kr_url", "doc_corp_reg_kr_url"],
  // 2 수권서 서명 — LOA 서명 데이터
  2: ["ubo_signature_data"],
  // 3 회사 추가정보 — 지분구조·대표자 서류·Payoneer
  3: ["ownership_structure",
      "rep_passport_front_url", "rep_passport_back_url", "rep_id_front_url", "rep_id_back_url", "rep_address_proof_url",
      "payoneer_status", "payoneer_email", "payoneer_note"],
  // 4 제품 등록 — onb_products / onb_product_countries 로 별도 관리
  4: [],
  // 5 물류 계약서 — onb_countries.logistics_contract_url 로 별도 관리
  5: [],
};

/** 스텝 필드 저장(화이트리스트 컬럼만). 잠금·검토중 스텝은 저장 거부. */
export async function saveStepFields(applicationId: string, stepNo: number, values: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const cols = STEP_FIELDS[stepNo] ?? [];
  const step = await queryOne<{ status: string }>("SELECT status FROM onb_steps WHERE application_id=$1 AND step_no=$2", [applicationId, stepNo]).catch(() => null);
  if (!step) return { ok: false, error: "스텝을 찾을 수 없습니다." };
  if (step.status === "locked") return { ok: false, error: "아직 잠긴 단계입니다." };
  if (step.status === "submitted" || step.status === "approved") return { ok: false, error: "제출/승인된 단계는 수정할 수 없습니다." };
  const set: string[] = []; const params: unknown[] = [applicationId]; let i = 2;
  for (const c of cols) {
    if (c in values) { set.push(`${c}=$${i++}`); params.push(values[c] ?? null); }
  }
  if (stepNo === 2 && "ubo_signature_data" in values && values.ubo_signature_data) {
    set.push(`ubo_signed_at=now()`);
  }
  if (set.length === 0) return { ok: true };
  try {
    await query(`UPDATE onb_applications SET ${set.join(", ")}, updated_at=now() WHERE id=$1`, params);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "저장 실패" }; }
}

/** 고객: 스텝 제출 → submitted. */
export async function submitStep(applicationId: string, stepNo: number): Promise<{ ok: boolean; error?: string }> {
  const r = await queryOne<{ step_no: number }>(
    "UPDATE onb_steps SET status='submitted', submitted_at=now() WHERE application_id=$1 AND step_no=$2 AND status IN ('unlocked','rejected') RETURNING step_no",
    [applicationId, stepNo]).catch(() => null);
  if (!r) return { ok: false, error: "제출할 수 없는 상태입니다." };
  return { ok: true };
}

// ── 이사(directors) ──
export interface OnbDirector { id: string; is_ubo: boolean; name: string; birth: string; country: string; id_type: string; id_number: string }
export async function getDirectors(applicationId: string): Promise<OnbDirector[]> {
  return query<OnbDirector>("SELECT id, is_ubo, name, birth, country, id_type, id_number FROM onb_directors WHERE application_id=$1 ORDER BY created_at", [applicationId]).catch(() => []);
}
export async function addDirector(applicationId: string, d: Partial<OnbDirector>): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO onb_directors (application_id, is_ubo, name, birth, country, id_type, id_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [applicationId, !!d.is_ubo, d.name ?? "", d.birth ?? "", d.country ?? "", d.id_type ?? "passport", d.id_number ?? ""]);
    return { ok: true, id: r!.id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "추가 실패" }; }
}
export async function deleteDirector(applicationId: string, id: string): Promise<{ ok: boolean }> {
  await query("DELETE FROM onb_directors WHERE id=$1 AND application_id=$2", [id, applicationId]).catch(() => {});
  return { ok: true };
}

// ── 창고(warehouses) ──
export interface OnbWarehouse { id: string; country: string; region: string; contact: string; phone: string; address: string; contract_url: string }
export async function getWarehouses(applicationId: string): Promise<OnbWarehouse[]> {
  return query<OnbWarehouse>("SELECT id, country, region, contact, phone, address, contract_url FROM onb_warehouses WHERE application_id=$1 ORDER BY created_at", [applicationId]).catch(() => []);
}
export async function addWarehouse(applicationId: string, w: Partial<OnbWarehouse>): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO onb_warehouses (application_id, country, region, contact, phone, address, contract_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [applicationId, w.country ?? "", w.region ?? "", w.contact ?? "", w.phone ?? "", w.address ?? "", w.contract_url ?? ""]);
    return { ok: true, id: r!.id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "추가 실패" }; }
}
export async function deleteWarehouse(applicationId: string, id: string): Promise<{ ok: boolean }> {
  await query("DELETE FROM onb_warehouses WHERE id=$1 AND application_id=$2", [id, applicationId]).catch(() => {});
  return { ok: true };
}

// ── 제품(products) ──
export interface OnbProduct { id: string; name: string; category: string; sku: string; description_kr: string; main_image_url: string }
export interface OnbProductCountry { id: string; product_id: string; country_code: string; unit_price: string; currency: string; cert_status: string; cert_note: string; cert_file_url: string; detail_page_kr: string; detail_page_translated: string; translation_status: string }
export async function getProducts(applicationId: string): Promise<OnbProduct[]> {
  return query<OnbProduct>("SELECT id, name, category, sku, description_kr, main_image_url FROM onb_products WHERE application_id=$1 ORDER BY created_at", [applicationId]).catch(() => []);
}
export async function getProductCountries(productId: string): Promise<OnbProductCountry[]> {
  return query<OnbProductCountry>("SELECT * FROM onb_product_countries WHERE product_id=$1 ORDER BY country_code", [productId]).catch(() => []);
}
export async function addProduct(applicationId: string, p: Partial<OnbProduct>): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO onb_products (application_id, name, category, sku, description_kr, main_image_url)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [applicationId, p.name ?? "", p.category ?? "", p.sku ?? "", p.description_kr ?? "", p.main_image_url ?? ""]);
    return { ok: true, id: r!.id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "추가 실패" }; }
}
export async function updateProduct(applicationId: string, id: string, p: Partial<OnbProduct>): Promise<{ ok: boolean }> {
  await query(
    `UPDATE onb_products SET name=$3, category=$4, sku=$5, description_kr=$6, main_image_url=$7
     WHERE id=$1 AND application_id=$2`,
    [id, applicationId, p.name ?? "", p.category ?? "", p.sku ?? "", p.description_kr ?? "", p.main_image_url ?? ""]).catch(() => {});
  return { ok: true };
}
export async function deleteProduct(applicationId: string, id: string): Promise<{ ok: boolean }> {
  await query("DELETE FROM onb_products WHERE id=$1 AND application_id=$2", [id, applicationId]).catch(() => {});
  return { ok: true };
}
export async function upsertProductCountry(productId: string, pc: Partial<OnbProductCountry>): Promise<{ ok: boolean; error?: string }> {
  try {
    if (pc.id) {
      await query(
        `UPDATE onb_product_countries SET country_code=$2, unit_price=$3, currency=$4, cert_status=$5, cert_note=$6, cert_file_url=$7, detail_page_kr=$8, detail_page_translated=$9, translation_status=$10 WHERE id=$1`,
        [pc.id, pc.country_code ?? "", pc.unit_price ?? "", pc.currency ?? "USD", pc.cert_status ?? "none", pc.cert_note ?? "", pc.cert_file_url ?? "", pc.detail_page_kr ?? "", pc.detail_page_translated ?? "", pc.translation_status ?? "draft"]);
    } else {
      await query(
        `INSERT INTO onb_product_countries (product_id, country_code, unit_price, currency, cert_status, cert_note, cert_file_url, detail_page_kr, detail_page_translated, translation_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [productId, pc.country_code ?? "", pc.unit_price ?? "", pc.currency ?? "USD", pc.cert_status ?? "none", pc.cert_note ?? "", pc.cert_file_url ?? "", pc.detail_page_kr ?? "", pc.detail_page_translated ?? "", pc.translation_status ?? "draft"]);
    }
    return { ok: true };
  } catch { return { ok: false }; }
}
export async function deleteProductCountry(id: string): Promise<{ ok: boolean }> {
  await query("DELETE FROM onb_product_countries WHERE id=$1", [id]).catch(() => {});
  return { ok: true };
}

// ── 입점 희망 국가(Step1 매트릭스) + 물류계약서(Step5) — onb_countries ──
export const TIKTOK_COUNTRIES: [string, string][] = [
  ["US", "미국"], ["TH", "태국"], ["VN", "베트남"], ["MY", "말레이시아"], ["SG", "싱가포르"], ["PH", "필리핀"],
];
export const READINESS: [string, string][] = [["none", "없음"], ["preparing", "준비중"], ["ready", "완료"]];
export const CURRENCIES = ["USD", "KRW", "SGD", "THB", "VND", "MYR", "PHP"];
export const COMPANY_COUNTRIES: [string, string][] = [
  ["KR", "대한민국"], ["US", "미국"], ["SG", "싱가포르"], ["JP", "일본"], ["CN", "중국"], ["HK", "홍콩"],
];

export interface OnbCountry {
  id: string; country_code: string; country_name: string;
  has_existing_shop: number; shop_type: string; shop_url: string; monthly_revenue: string;
  product_cert_status: string; product_cert_note: string;
  logistics_status: string; logistics_note: string; logistics_contract_url: string;
  logistics_option: string;  // self_delivery|local_warehouse|flash_intro
}
export const LOGISTICS_OPTIONS: [string, string][] = [
  ["self_delivery", "직배송(직접 배송)"], ["local_warehouse", "현지 물류창고"], ["flash_intro", "플래시 소개(제휴)"],
];
export async function getCountries(applicationId: string): Promise<OnbCountry[]> {
  return query<OnbCountry>("SELECT * FROM onb_countries WHERE application_id=$1 ORDER BY country_code", [applicationId]).catch(() => []);
}
/** Step1 국가 매트릭스 저장 — 선택 코드 집합으로 동기화(미선택은 삭제). */
export async function setCountries(applicationId: string, rows: Partial<OnbCountry>[]): Promise<{ ok: boolean }> {
  const keep = rows.map((r) => (r.country_code || "").toUpperCase()).filter(Boolean);
  try {
    if (keep.length) await query(`DELETE FROM onb_countries WHERE application_id=$1 AND country_code<>ALL($2)`, [applicationId, keep]);
    else await query("DELETE FROM onb_countries WHERE application_id=$1", [applicationId]);
    for (const r of rows) {
      const code = (r.country_code || "").toUpperCase(); if (!code) continue;
      const name = TIKTOK_COUNTRIES.find(([c]) => c === code)?.[1] ?? "";
      await query(
        `INSERT INTO onb_countries (application_id, country_code, country_name, has_existing_shop, shop_type, shop_url, monthly_revenue, product_cert_status, product_cert_note, logistics_status, logistics_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (application_id, country_code) DO UPDATE SET
           has_existing_shop=EXCLUDED.has_existing_shop, shop_type=EXCLUDED.shop_type, shop_url=EXCLUDED.shop_url,
           monthly_revenue=EXCLUDED.monthly_revenue, product_cert_status=EXCLUDED.product_cert_status, product_cert_note=EXCLUDED.product_cert_note,
           logistics_status=EXCLUDED.logistics_status, logistics_note=EXCLUDED.logistics_note`,
        [applicationId, code, name, r.has_existing_shop ?? (r.shop_type && r.shop_type !== "none" ? 1 : 0),
         r.shop_type ?? "none", r.shop_url ?? "", r.monthly_revenue ?? "",
         r.product_cert_status ?? "none", r.product_cert_note ?? "", r.logistics_status ?? "none", r.logistics_note ?? ""]);
    }
    return { ok: true };
  } catch { return { ok: false }; }
}
/** Step5 국가별 물류계약서 URL 저장. */
export async function setCountryLogistics(applicationId: string, code: string, url: string): Promise<{ ok: boolean }> {
  await query("UPDATE onb_countries SET logistics_contract_url=$3 WHERE application_id=$1 AND country_code=$2", [applicationId, code.toUpperCase(), url]).catch(() => {});
  return { ok: true };
}
/** Step5 국가별 물류 방식(직배송/현지창고/플래시 소개) 저장. */
export async function setCountryLogisticsOption(applicationId: string, code: string, option: string): Promise<{ ok: boolean }> {
  await query("UPDATE onb_countries SET logistics_option=$3 WHERE application_id=$1 AND country_code=$2", [applicationId, code.toUpperCase(), option]).catch(() => {});
  return { ok: true };
}

// ── 파일 저장(Neon DB bytea) ──
export async function saveOnbFile(applicationId: string, field: string, filename: string, mime: string, bytes: Buffer, by: string): Promise<{ ok: boolean; id?: string; url?: string; error?: string }> {
  try {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO onb_files (application_id, field, filename, mime, size, bytes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [applicationId, field, filename, mime, bytes.length, bytes, by]);
    return { ok: true, id: r!.id, url: `/api/apply/file/${r!.id}` };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "업로드 실패" }; }
}
export async function getOnbFile(id: string): Promise<{ filename: string; mime: string; bytes: Buffer; application_id: string } | null> {
  return queryOne<{ filename: string; mime: string; bytes: Buffer; application_id: string }>("SELECT filename, mime, bytes, application_id FROM onb_files WHERE id=$1", [id]).catch(() => null);
}

// ── 관리자 뷰 ──
export interface OnbCustomerRow extends OnbCustomer { last_login_at: string | null; created_at: string; app_id: string | null; app_status: string | null; submitted_steps: number }
export async function listCustomers(): Promise<OnbCustomerRow[]> {
  return query<OnbCustomerRow>(
    `SELECT c.id, c.email, c.brand_id, c.note, c.active, c.last_login_at, c.created_at,
            a.id AS app_id, a.status AS app_status,
            COALESCE((SELECT count(*) FROM onb_steps s WHERE s.application_id=a.id AND s.status IN ('submitted','approved')),0)::int AS submitted_steps
       FROM onb_customers c
       LEFT JOIN onb_applications a ON a.customer_id=c.id
       ORDER BY c.created_at DESC`).catch(() => []);
}
export async function setCustomerActive(id: string, active: boolean): Promise<{ ok: boolean }> {
  await query("UPDATE onb_customers SET active=$2 WHERE id=$1", [id, active]).catch(() => {});
  return { ok: true };
}
/** 고객↔브랜드 연결(발급 후 지정). 신청서에도 전파해 승인 시 매핑 대상이 되도록 함. */
export async function setCustomerBrand(customerId: string, brandId: string | null): Promise<{ ok: boolean }> {
  await query("UPDATE onb_customers SET brand_id=$2 WHERE id=$1", [customerId, brandId]).catch(() => {});
  await query("UPDATE onb_applications SET brand_id=$2, updated_at=now() WHERE customer_id=$1", [customerId, brandId]).catch(() => {});
  return { ok: true };
}

/** 관리자: 스텝 검토 결과 반영. approve 시 다음 스텝 잠금해제, reject 시 피드백과 함께 반려. */
export async function reviewStep(applicationId: string, stepNo: number, decision: "approve" | "reject" | "unapprove", feedback: string): Promise<{ ok: boolean; error?: string }> {
  const step = await queryOne<{ status: string }>("SELECT status FROM onb_steps WHERE application_id=$1 AND step_no=$2", [applicationId, stepNo]).catch(() => null);
  if (!step) return { ok: false, error: "스텝을 찾을 수 없습니다." };
  if (decision === "reject") {
    await query("UPDATE onb_steps SET status='rejected', admin_feedback=$3, reviewed_at=now() WHERE application_id=$1 AND step_no=$2", [applicationId, stepNo, feedback || ""]);
    return { ok: true };
  }
  if (decision === "unapprove") {
    // 승인취소 — 승인된 단계만. 재검토 가능하도록 'submitted' 로 되돌림.
    if (step.status !== "approved") return { ok: false, error: "승인된 단계만 취소할 수 있습니다." };
    await query("UPDATE onb_steps SET status='submitted', admin_feedback='', reviewed_at=NULL WHERE application_id=$1 AND step_no=$2", [applicationId, stepNo]);
    // 다음 단계가 이 승인으로만 열려 있고(고객 미제출·미승인) 아직 'unlocked' 라면 다시 잠근다.
    if (stepNo < 5) {
      await query("UPDATE onb_steps SET status='locked', unlocked_at=NULL WHERE application_id=$1 AND step_no=$2 AND status='unlocked'", [applicationId, stepNo + 1]).catch(() => {});
    }
    return { ok: true };
  }
  // approve
  await query("UPDATE onb_steps SET status='approved', admin_feedback=$3, reviewed_at=now() WHERE application_id=$1 AND step_no=$2", [applicationId, stepNo, feedback || ""]);
  // 다음 스텝 잠금해제(잠긴 경우만) — 5스텝
  if (stepNo < 5) {
    await query("UPDATE onb_steps SET status='unlocked', unlocked_at=now() WHERE application_id=$1 AND step_no=$2 AND status='locked'", [applicationId, stepNo + 1]).catch(() => {});
  }
  // 단계별 개별 승인 즉시 원장 부분 매핑(브랜드 연결 시) — finalize 안 함(전체 승인은 별도).
  await approveApplication(applicationId, "step-approve", { finalize: false }).catch(() => {});
  return { ok: true };
}

// 인증 상태 매핑: onb(none|preparing|ready) → product_certs(none|preparing|ready)
function certStatus(s: string | undefined): string {
  return s === "ready" || s === "preparing" ? s : "none";
}

/** 관리자: 신청서 매핑 → 모든 KYC 필드를 브랜드 원장에 하나도 빠짐없이 반영.
 *   finalize=true(기본): 신청서/스텝 상태를 approved 로 확정.
 *   finalize=false: 매핑만(단계별 개별 승인 시 그 시점 데이터를 원장에 즉시 반영). */
export async function approveApplication(applicationId: string, by: string, opts?: { finalize?: boolean }): Promise<{ ok: boolean; error?: string; mappedProducts?: number; mappedCountries?: number; mappedContacts?: number }> {
  const finalize = opts?.finalize !== false;
  const app = await getApplicationById(applicationId);
  if (!app) return { ok: false, error: "신청서를 찾을 수 없습니다." };
  const brandId = app.brand_id as string | null;
  if (!brandId) return { ok: false, error: "연결된 브랜드가 없습니다. 먼저 브랜드를 연결하세요." };
  const s = (k: string): string => (app[k] == null ? "" : String(app[k]));
  try {
    // ── 1) 회사·대표자·Payoneer·서명·서류 → brand_company (전 필드 매핑) ──
    const directors = await getDirectors(applicationId);  // v1 잔존분(있으면 보존), v2 고객플로우엔 없음
    const channelUrls = JSON.stringify({
      sales_channel: s("sales_channel_url"),
      shop_kr: s("shop_name_kr"), shop_en: s("shop_name_en"),
    });
    // COALESCE(NULLIF(new,''), old) 패턴 — 빈 값은 기존 원장 값을 덮지 않음.
    const cols: [string, unknown][] = [
      ["company_name_kr", s("company_name_kr")], ["company_name_en", s("company_name_en")],
      ["company_type", s("company_type")], ["company_country", s("company_country")],
      ["reg_date", s("company_reg_date")], ["company_reg_number", s("company_reg_number")],
      ["rep_name", s("ubo_full_name") || s("contact_name")],
      ["contact_name", s("contact_name")], ["contact_email", s("contact_email")], ["contact_phone", s("contact_phone")],
      ["address_kr", s("address_kr")], ["address_en", s("address_en")], ["op_address_en", s("op_address_en")],
      ["shop_name_kr", s("shop_name_kr")], ["shop_name_en", s("shop_name_en")],
      ["brand_name_en", s("shop_name_en")], ["brand_logo_url", s("brand_logo_url")],
      ["product_category", s("product_category")], ["sales_channel_url", s("sales_channel_url")],
      ["doc_biz_reg_en_url", s("doc_biz_reg_en_url")], ["doc_biz_reg_kr_url", s("doc_biz_reg_kr_url")],
      ["doc_corp_reg_kr_url", s("doc_corp_reg_kr_url")], ["doc_ownership_url", s("doc_ownership_url")],
      ["doc_logistics_url", s("doc_logistics_url")],
      ["ubo_full_name", s("ubo_full_name")], ["ubo_title", s("ubo_title")], ["ubo_birth", s("ubo_birth")],
      ["ubo_country", s("ubo_country")], ["ubo_id_type", s("ubo_id_type")], ["ubo_id_number", s("ubo_id_number")],
      ["ubo_id_front_url", s("ubo_id_front_url")], ["ubo_id_back_url", s("ubo_id_back_url")],
      ["ubo_address_proof_url", s("ubo_address_proof_url")], ["ownership_structure", s("ownership_structure")],
      ["auth_type", s("auth_type")], ["auth_name", s("auth_name")], ["auth_birth", s("auth_birth")],
      ["auth_country", s("auth_country")], ["auth_id_type", s("auth_id_type")], ["auth_id_number", s("auth_id_number")],
      ["auth_email", s("auth_email")], ["auth_id_front_url", s("auth_id_front_url")],
      ["auth_id_back_url", s("auth_id_back_url")], ["auth_address_proof_url", s("auth_address_proof_url")],
      ["auth_loa_url", s("auth_loa_url")], ["pep_q1", s("pep_q1")], ["pep_q2", s("pep_q2")],
      ["ubo_signature_data", s("ubo_signature_data")],
      ["payoneer_status", s("payoneer_status")], ["payoneer_email", s("payoneer_email")], ["payoneer_note", s("payoneer_note")],
      // 대표자 서류(Step3) + 서명자 IP (0039)
      ["rep_passport_front_url", s("rep_passport_front_url")], ["rep_passport_back_url", s("rep_passport_back_url")],
      ["rep_id_front_url", s("rep_id_front_url")], ["rep_id_back_url", s("rep_id_back_url")],
      ["rep_address_proof_url", s("rep_address_proof_url")], ["ubo_signer_ip", s("ubo_signer_ip")],
    ];
    const insCols = ["brand_id", "source", "channel_urls", "directors_json", "onb_application_id", "onb_synced_at", "ubo_signed_at", ...cols.map((c) => c[0])];
    const insVals: unknown[] = [brandId, "apply", channelUrls, JSON.stringify(directors), applicationId, new Date().toISOString(),
      app.ubo_signed_at ?? null, ...cols.map((c) => c[1])];
    const place = insCols.map((_, i) => `$${i + 1}`);
    // 텍스트 컬럼만 COALESCE(NULLIF) 로 빈값 보존; 나머지(source/json/id/시각)는 항상 갱신.
    const preserve = new Set(cols.map((c) => c[0]));
    const upd = insCols.slice(1).map((c) =>
      preserve.has(c) ? `${c}=COALESCE(NULLIF(EXCLUDED.${c},''), brand_company.${c})` : `${c}=EXCLUDED.${c}`
    ).join(", ");
    await query(
      `INSERT INTO brand_company (${insCols.join(",")}) VALUES (${place.join(",")})
       ON CONFLICT (brand_id) DO UPDATE SET ${upd}, updated_at=now()`, insVals);

    // ── 2) 담당자 → brand_contacts (main upsert) ──
    let mappedContacts = 0;
    const contactName = s("contact_name");
    if (contactName) {
      const ex = await queryOne<{ id: string }>(
        "SELECT id FROM brand_contacts WHERE brand_id=$1 AND role='main' ORDER BY is_primary DESC, created_at LIMIT 1", [brandId]).catch(() => null);
      if (ex) {
        await query("UPDATE brand_contacts SET name=$2, email=$3, phone=$4 WHERE id=$1",
          [ex.id, contactName, s("contact_email") || null, s("contact_phone") || null]).catch(() => {});
      } else {
        await query(
          `INSERT INTO brand_contacts (brand_id, name, title, email, phone, role, is_primary, note)
           VALUES ($1,$2,'담당자',$3,$4,'main',true,'온보딩 신청서에서 매핑')`,
          [brandId, contactName, s("contact_email") || null, s("contact_phone") || null]).catch(() => {});
      }
      mappedContacts = 1;
    }

    // ── 3) 입점 희망 국가 → brand.countries + 국가별 물류 → logistics_contracts ──
    const countries = await getCountries(applicationId);
    let mappedCountries = 0;
    const codes = countries.map((c) => c.country_code.toUpperCase()).filter(Boolean);
    if (codes.length) {
      await query("UPDATE brands SET countries=(SELECT array_agg(DISTINCT c) FROM unnest(countries || $2::text[]) c) WHERE id=$1", [brandId, codes]).catch(() => {});
    }
    for (const c of countries) {
      const code = c.country_code.toUpperCase(); if (!code) continue;
      const ref = `[onb:${c.id}]`;
      const status = c.logistics_status === "ready" ? "active" : c.logistics_status === "preparing" ? "negotiating" : "none";
      const optLabel = LOGISTICS_OPTIONS.find(([o]) => o === c.logistics_option)?.[1];
      const note = [c.logistics_note, optLabel && `방식: ${optLabel}`, c.logistics_contract_url && `계약서: ${c.logistics_contract_url}`, c.monthly_revenue && `월매출: ${c.monthly_revenue}`].filter(Boolean).join(" · ");
      const ex = await queryOne<{ id: string }>("SELECT id FROM logistics_contracts WHERE brand_id=$1 AND note LIKE $2", [brandId, `%${ref}%`]).catch(() => null);
      if (ex) {
        await query("UPDATE logistics_contracts SET country=$2, status=$3, note=$4 WHERE id=$1", [ex.id, code, status, `${note} ${ref}`]).catch(() => {});
      } else {
        await query(`INSERT INTO logistics_contracts (brand_id, country, status, note) VALUES ($1,$2,$3,$4)`,
          [brandId, code, status, `${note} ${ref}`]).catch(() => {});
      }
      mappedCountries++;
    }

    // ── 4) 제품 → products_master + 국가별 인증 → product_certs ──
    const prods = await getProducts(applicationId);
    let mapped = 0;
    for (const p of prods) {
      const ref = `onb:${p.id}`;
      let pmId: string | undefined;
      const exists = await queryOne<{ id: string }>(
        "SELECT id FROM products_master WHERE brand_id=$1 AND source_ref=$2", [brandId, ref]).catch(() => null);
      if (exists) {
        pmId = exists.id;
        await query("UPDATE products_master SET name_kr=$2, category=$3, sku=$4, main_image_url=$5 WHERE id=$1",
          [exists.id, p.name || "(무제)", p.category ?? "", p.sku ?? "", p.main_image_url ?? ""]).catch(() => {});
      } else {
        const ins = await queryOne<{ id: string }>(
          `INSERT INTO products_master (brand_id, name_kr, name_en, category, sku, main_image_url, status, source, source_ref)
           VALUES ($1,$2,'',$3,$4,$5,'active','apply_step4',$6) RETURNING id`,
          [brandId, p.name || "(무제)", p.category ?? "", p.sku ?? "", p.main_image_url ?? "", ref]).catch(() => null);
        pmId = ins?.id;
      }
      // 제품×국가 → product_certs (UNIQUE product_id,country,cert_type='수입인증')
      if (pmId) {
        const pcs = await getProductCountries(p.id);
        for (const pc of pcs) {
          const country = (pc.country_code || "").toUpperCase();
          if (!country) continue;
          await query(
            `INSERT INTO product_certs (product_id, country, cert_type, status, note, updated_at)
             VALUES ($1,$2,'수입인증',$3,$4,now())
             ON CONFLICT (product_id, country, cert_type) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note, updated_at=now()`,
            [pmId, country, certStatus(pc.cert_status), [pc.cert_note, pc.cert_file_url && `증빙: ${pc.cert_file_url}`, pc.unit_price && `단가: ${pc.currency} ${pc.unit_price}`].filter(Boolean).join(" · ")]).catch(() => {});
        }
      }
      mapped++;
    }

    // ── 5) 신청서/스텝 승인 확정 (finalize=true 일 때만) ──
    if (finalize) {
      await query("UPDATE onb_applications SET status='approved', admin_memo=CONCAT(admin_memo, E'\n[승인] ', $2::text), updated_at=now() WHERE id=$1", [applicationId, by]);
      await query("UPDATE onb_steps SET status='approved', reviewed_at=now() WHERE application_id=$1 AND status IN ('submitted','unlocked')", [applicationId]).catch(() => {});
    }
    return { ok: true, mappedProducts: mapped, mappedCountries, mappedContacts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "매핑 실패" };
  }
}
