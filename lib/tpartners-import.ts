// apply.tpartners.live 일회성 이관 — 신청(application) → brands + brand_company + 파일 매핑.
//   · 멱등: 원본 app id(tp_import_apps)로 재실행 시 중복 없음.
//   · 매칭: 사업자번호(digits)·이메일로 기존 브랜드 찾으면 병합(빈 값만 보완), 없으면 신규.
//   · 컬럼 적응형: brand_company/brands 에 실제 존재하는 컬럼만 채움(스키마 차이에도 안전).
//   · 드라이런: 매칭만 하고 쓰기 없음 → 리포트 반환.
import { query, queryOne } from "./db";

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
const digits = (v: unknown): string => s(v).replace(/\D/g, "");
const base = (v: unknown): string => s(v).split("/").pop() ?? "";

// brand_company 텍스트 컬럼 ← 원본 필드(동명). 존재하는 컬럼만 사용.
const COMPANY_FIELDS = [
  "company_name_kr", "company_name_en", "company_type", "company_country", "company_reg_date",
  "company_reg_number", "contact_name", "contact_email", "contact_phone", "address_kr", "address_en",
  "op_address_en", "shop_name_kr", "shop_name_en", "product_category", "sales_channel_url",
  "ubo_full_name", "ubo_title", "ubo_birth", "ubo_country", "ubo_id_type", "ubo_id_number",
  "ownership_structure", "auth_type", "auth_name", "auth_birth", "auth_country", "auth_id_type",
  "auth_id_number", "auth_email", "pep_q1", "pep_q2", "ubo_signature_data", "ubo_signer_ip",
  "payoneer_status", "payoneer_email", "payoneer_note",
];

// 원본 *_path 필드 → brand_company URL 컬럼(파일 이관 시 이 컬럼에 스트리밍 URL 설정).
const FILE_FIELDS: { src: string; urlCol: string }[] = [
  { src: "brand_logo_path", urlCol: "brand_logo_url" },
  { src: "doc_biz_reg_en_path", urlCol: "doc_biz_reg_en_url" },
  { src: "doc_biz_reg_kr_path", urlCol: "doc_biz_reg_kr_url" },
  { src: "doc_corp_reg_kr_path", urlCol: "doc_corp_reg_kr_url" },
  { src: "doc_ownership_path", urlCol: "doc_ownership_url" },
  { src: "doc_logistics_path", urlCol: "doc_logistics_url" },
  { src: "ubo_id_front_path", urlCol: "ubo_id_front_url" },
  { src: "ubo_id_back_path", urlCol: "ubo_id_back_url" },
  { src: "ubo_address_proof_path", urlCol: "ubo_address_proof_url" },
  { src: "auth_id_front_path", urlCol: "auth_id_front_url" },
  { src: "auth_id_back_path", urlCol: "auth_id_back_url" },
  { src: "auth_address_proof_path", urlCol: "auth_address_proof_url" },
  { src: "auth_loa_path", urlCol: "auth_loa_url" },
  { src: "loa_doc_path", urlCol: "auth_loa_url" },
  { src: "rep_passport_front_path", urlCol: "rep_passport_front_url" },
  { src: "rep_passport_back_path", urlCol: "rep_passport_back_url" },
  { src: "rep_id_front_path", urlCol: "rep_id_front_url" },
  { src: "rep_id_back_path", urlCol: "rep_id_back_url" },
  { src: "rep_address_proof_path", urlCol: "rep_address_proof_url" },
];

async function tableColumns(table: string): Promise<Set<string>> {
  const rows = await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name=$1", [table],
  ).catch(() => [] as { column_name: string }[]);
  return new Set(rows.map((r) => r.column_name));
}

export interface ImportReport {
  dryRun: boolean;
  total: number;
  created: { ext_app_id: number; brand: string }[];
  merged: { ext_app_id: number; brand: string; matched_by: string }[];
  skipped: { ext_app_id: number; brand: string; reason: string }[];
  files_expected: number;
  errors: { ext_app_id: number; error: string }[];
}

/** 신청 목록 이관. dryRun 이면 매칭만 하고 쓰기 없음. */
export async function importApplications(apps: Row[], opts: { dryRun: boolean }): Promise<ImportReport> {
  const report: ImportReport = { dryRun: opts.dryRun, total: apps.length, created: [], merged: [], skipped: [], files_expected: 0, errors: [] };
  const brandCols = await tableColumns("brands");
  const companyCols = (await tableColumns("brand_company"));
  const useCompany = COMPANY_FIELDS.filter((c) => companyCols.has(c));

  for (const app of apps) {
    const extId = Number(app.id);
    const name = s(app.company_name_kr) || s(app.shop_name_kr) || s(app.company_name_en) || `app-${extId}`;
    try {
      // 이미 이관됨?
      const prior = await queryOne<{ brand_id: string }>("SELECT brand_id FROM tp_import_apps WHERE ext_app_id=$1", [extId]).catch(() => null);
      if (prior) { report.skipped.push({ ext_app_id: extId, brand: name, reason: "이미 이관됨(멱등)" }); recordFiles(app, prior.brand_id, opts.dryRun, report); continue; }

      // 기존 브랜드 매칭: 사업자번호 → 이메일 순.
      const biz = digits(app.company_reg_number);
      const email = s(app.contact_email).toLowerCase();
      let matchBy = "";
      let brandId = "";
      if (biz) {
        const m = await queryOne<{ id: string }>("SELECT id FROM brands WHERE regexp_replace(coalesce(biz_no,''),'\\D','','g')=$1 LIMIT 1", [biz]).catch(() => null);
        if (m) { brandId = m.id; matchBy = `사업자번호 ${biz}`; }
      }
      if (!brandId && email) {
        const m = await queryOne<{ id: string }>("SELECT id FROM brands WHERE lower(email)=$1 LIMIT 1", [email]).catch(() => null);
        if (m) { brandId = m.id; matchBy = `이메일 ${email}`; }
      }

      if (opts.dryRun) {
        if (brandId) report.merged.push({ ext_app_id: extId, brand: name, matched_by: matchBy });
        else report.created.push({ ext_app_id: extId, brand: name });
        countFiles(app, report);
        continue;
      }

      // ── 실제 쓰기 ──
      if (!brandId) {
        const cols: string[] = [], vals: unknown[] = [], ph: string[] = [];
        const add = (c: string, v: unknown) => { if (brandCols.has(c)) { cols.push(c); vals.push(v); ph.push(`$${vals.length}`); } };
        add("brand_name", name);
        add("email", s(app.contact_email) || null);
        add("phone", s(app.contact_phone) || null);
        add("biz_no", biz || null);
        add("contact_name", s(app.contact_name) || null);
        add("category", s(app.product_category) || null);
        add("brand_url", s(app.sales_channel_url) || null);
        add("source", "tpartners");
        add("state", "lead_new");
        const row = await queryOne<{ id: string }>(
          `INSERT INTO brands (${cols.join(",")}) VALUES (${ph.join(",")}) RETURNING id`, vals,
        );
        brandId = row!.id;
      }

      // brand_company upsert(빈 값만 보완).
      if (useCompany.length) {
        const cols = useCompany;
        const vals: unknown[] = [brandId, ...cols.map((c) => s(app[c]) || null)];
        const ph = cols.map((_, i) => `$${i + 2}`);
        const setClause = cols.map((c) => `${c}=COALESCE(NULLIF(brand_company.${c},''), EXCLUDED.${c})`).join(", ");
        await query(
          `INSERT INTO brand_company (brand_id, ${cols.join(",")}) VALUES ($1, ${ph.join(",")})
           ON CONFLICT (brand_id) DO UPDATE SET ${setClause}, updated_at=now()`,
          vals,
        ).catch(async (e) => {
          // updated_at 없을 수도 → 재시도(빼고).
          if (/updated_at/.test((e as Error).message)) {
            await query(
              `INSERT INTO brand_company (brand_id, ${cols.join(",")}) VALUES ($1, ${ph.join(",")})
               ON CONFLICT (brand_id) DO UPDATE SET ${setClause}`, vals,
            );
          } else throw e;
        });
      }

      // 파일 매핑 기록.
      recordFiles(app, brandId, false, report);

      await query("INSERT INTO tp_import_apps (ext_app_id, brand_id, merged) VALUES ($1,$2,$3) ON CONFLICT (ext_app_id) DO NOTHING",
        [extId, brandId, Boolean(matchBy)]);

      if (matchBy) report.merged.push({ ext_app_id: extId, brand: name, matched_by: matchBy });
      else report.created.push({ ext_app_id: extId, brand: name });
    } catch (e) {
      report.errors.push({ ext_app_id: extId, error: (e as Error).message });
    }
  }
  return report;
}

function countFiles(app: Row, report: ImportReport) {
  for (const f of FILE_FIELDS) if (s(app[f.src])) report.files_expected++;
}

async function recordFiles(app: Row, brandId: string, dryRun: boolean, report: ImportReport) {
  for (const f of FILE_FIELDS) {
    const fn = base(app[f.src]);
    if (!fn) continue;
    report.files_expected++;
    if (dryRun) continue;
    await query(
      "INSERT INTO tp_import_files (filename, brand_id, doc_field) VALUES ($1,$2,$3) ON CONFLICT (filename) DO UPDATE SET brand_id=EXCLUDED.brand_id, doc_field=EXCLUDED.doc_field",
      [fn, brandId, f.urlCol],
    ).catch(() => {});
  }
}

// ── 파일 이관: 파일명 → 브랜드/서류 매칭 후 저장 + brand_company URL 설정 ──
export interface FileResult { ok: boolean; matched: boolean; brand_id?: string; doc_field?: string; error?: string; skipped?: string }

export async function storeImportFile(input: { filename: string; mime: string; bytes: Buffer; sha256?: string }): Promise<FileResult> {
  const map = await queryOne<{ brand_id: string; doc_field: string }>(
    "SELECT brand_id, doc_field FROM tp_import_files WHERE filename=$1", [input.filename],
  ).catch(() => null);
  if (!map) return { ok: true, matched: false, skipped: "매칭 없음(먼저 행 이관 필요하거나 미참조 파일)" };

  // 이미 저장됨? (멱등)
  const dup = await queryOne<{ id: string }>("SELECT id FROM import_files WHERE brand_id=$1 AND filename=$2", [map.brand_id, input.filename]).catch(() => null);
  let id = dup?.id ?? "";
  if (!id) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO import_files (brand_id, doc_field, filename, mime, size, sha256, bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [map.brand_id, map.doc_field, input.filename, input.mime || "application/octet-stream", input.bytes.length, input.sha256 ?? null, input.bytes],
    );
    id = row!.id;
  }

  // brand_company URL 컬럼이면 스트리밍 URL 설정(존재하는 컬럼만).
  if (/^[a-z_]+_url$/.test(map.doc_field)) {
    const cols = await tableColumns("brand_company");
    if (cols.has(map.doc_field)) {
      await query(
        `INSERT INTO brand_company (brand_id, ${map.doc_field}) VALUES ($1,$2)
         ON CONFLICT (brand_id) DO UPDATE SET ${map.doc_field}=EXCLUDED.${map.doc_field}`,
        [map.brand_id, `/api/brand/import-file/${id}`],
      ).catch(() => {});
    }
  }
  return { ok: true, matched: true, brand_id: map.brand_id, doc_field: map.doc_field };
}

export async function getImportFile(id: string): Promise<{ bytes: Buffer; mime: string | null; filename: string } | null> {
  const r = await queryOne<{ bytes: Buffer; mime: string | null; filename: string }>(
    "SELECT bytes, mime, filename FROM import_files WHERE id=$1", [id],
  ).catch(() => null);
  return r ?? null;
}
