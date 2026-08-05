// 제안서 문서(자동생성) 데이터 계층 — 공개 렌더(/proposal/[token]) + 어드민 빌더 공용.
import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";

export interface ProposalProduct { name: string; image_url?: string; desc?: string }
export interface ProposalCreator {
  handle: string; product?: string; revenue?: string; roas?: string;
  fee_rate?: string; engagement?: string; thumb_url?: string; caption?: string;
}

export interface ProposalDoc {
  id: string;
  brand_id: string | null;
  token: string;
  title: string;
  subtitle: string;
  brand_name: string;
  brand_logo_url: string | null;
  track: string;
  list_amount: number | null;
  monthly_amount: number | null;
  fee_pct: number | null;
  term_months: number | null;
  term_discount_pct: number | null;
  features: string[];
  seeding_qty: number | null;
  live_qty: number | null;
  op_tags: string[];
  kpi_tier: string | null;
  kpi_stage: string | null;
  kpi_creator_content: number | null;
  kpi_ad_spend: string | null;
  products: ProposalProduct[];
  creators: ProposalCreator[];
  accent: string | null;
  status: "draft" | "published";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalTemplate {
  id: string; name: string; is_default: boolean; accent: string;
  agency_name: string; agency_logo_url: string | null;
  default_title: string; default_subtitle: string; sections: string[];
}

const TRACK_LABEL: Record<string, string> = { onboarding: "ONBOARDING TRACK", mall: "MULTI-MALL TRACK", marketing: "MARKETING TRACK" };
export function trackLabel(t: string): string { return TRACK_LABEL[t] ?? t.toUpperCase(); }

export async function defaultTemplate(): Promise<ProposalTemplate | null> {
  return queryOne<ProposalTemplate>(
    "SELECT id, name, is_default, accent, agency_name, agency_logo_url, default_title, default_subtitle, sections FROM proposal_templates WHERE is_default ORDER BY updated_at DESC LIMIT 1",
  ).catch(() => null);
}

export async function getProposalByToken(token: string): Promise<ProposalDoc | null> {
  return queryOne<ProposalDoc>("SELECT * FROM proposal_docs WHERE token=$1", [token]).catch(() => null);
}

export async function getProposalById(id: string): Promise<ProposalDoc | null> {
  return queryOne<ProposalDoc>("SELECT * FROM proposal_docs WHERE id=$1", [id]).catch(() => null);
}

export async function listProposals(brandId?: string): Promise<ProposalDoc[]> {
  if (brandId) return query<ProposalDoc>("SELECT * FROM proposal_docs WHERE brand_id=$1 ORDER BY created_at DESC", [brandId]).catch(() => []);
  return query<ProposalDoc>("SELECT * FROM proposal_docs ORDER BY created_at DESC LIMIT 100").catch(() => []);
}

export interface ProposalInput {
  brand_id?: string | null;
  title?: string; subtitle?: string; brand_name?: string; brand_logo_url?: string | null;
  track?: string;
  list_amount?: number | null; monthly_amount?: number | null; fee_pct?: number | null;
  term_months?: number | null; term_discount_pct?: number | null;
  features?: string[]; seeding_qty?: number | null; live_qty?: number | null; op_tags?: string[];
  kpi_tier?: string | null; kpi_stage?: string | null; kpi_creator_content?: number | null; kpi_ad_spend?: string | null;
  products?: ProposalProduct[]; creators?: ProposalCreator[]; accent?: string | null;
  status?: "draft" | "published";
}

/** 생성/수정 upsert. id 있으면 수정, 없으면 생성(token 발급). */
export async function saveProposal(input: ProposalInput & { id?: string }, by: string): Promise<{ id: string; token: string }> {
  if (input.id) {
    const row = await queryOne<{ id: string; token: string }>(
      `UPDATE proposal_docs SET
         title=COALESCE($2,title), subtitle=COALESCE($3,subtitle), brand_name=COALESCE($4,brand_name),
         brand_logo_url=$5, track=COALESCE($6,track),
         list_amount=$7, monthly_amount=$8, fee_pct=$9, term_months=$10, term_discount_pct=$11,
         features=COALESCE($12::jsonb,features), seeding_qty=$13, live_qty=$14, op_tags=COALESCE($15::jsonb,op_tags),
         kpi_tier=$16, kpi_stage=$17, kpi_creator_content=$18, kpi_ad_spend=$19,
         products=COALESCE($20::jsonb,products), creators=COALESCE($21::jsonb,creators),
         accent=$22, status=COALESCE($23,status), updated_at=now()
       WHERE id=$1 RETURNING id, token`,
      [input.id, input.title, input.subtitle, input.brand_name, input.brand_logo_url ?? null, input.track,
       input.list_amount ?? null, input.monthly_amount ?? null, input.fee_pct ?? null, input.term_months ?? null, input.term_discount_pct ?? null,
       input.features ? JSON.stringify(input.features) : null, input.seeding_qty ?? null, input.live_qty ?? null, input.op_tags ? JSON.stringify(input.op_tags) : null,
       input.kpi_tier ?? null, input.kpi_stage ?? null, input.kpi_creator_content ?? null, input.kpi_ad_spend ?? null,
       input.products ? JSON.stringify(input.products) : null, input.creators ? JSON.stringify(input.creators) : null,
       input.accent ?? null, input.status ?? null]);
    if (!row) throw new Error("제안서를 찾을 수 없습니다.");
    return row;
  }
  const token = randomBytes(9).toString("base64url");
  const row = await queryOne<{ id: string; token: string }>(
    `INSERT INTO proposal_docs
       (brand_id, token, title, subtitle, brand_name, brand_logo_url, track,
        list_amount, monthly_amount, fee_pct, term_months, term_discount_pct,
        features, seeding_qty, live_qty, op_tags, kpi_tier, kpi_stage, kpi_creator_content, kpi_ad_spend,
        products, creators, accent, status, created_by)
     VALUES ($1,$2,COALESCE($3,'틱톡샵 온보딩 및 마케팅 협업 제안서'),COALESCE($4,'크리에이터 커머스를 통한 브랜드 성장'),
        COALESCE($5,''),$6,COALESCE($7,'onboarding'),
        $8,$9,$10,$11,$12,COALESCE($13::jsonb,'[]'),$14,$15,COALESCE($16::jsonb,'[]'),$17,$18,$19,$20,
        COALESCE($21::jsonb,'[]'),COALESCE($22::jsonb,'[]'),$23,COALESCE($24,'draft'),$25)
     RETURNING id, token`,
    [input.brand_id ?? null, token, input.title, input.subtitle, input.brand_name, input.brand_logo_url ?? null, input.track,
     input.list_amount ?? null, input.monthly_amount ?? null, input.fee_pct ?? null, input.term_months ?? null, input.term_discount_pct ?? null,
     input.features ? JSON.stringify(input.features) : null, input.seeding_qty ?? null, input.live_qty ?? null, input.op_tags ? JSON.stringify(input.op_tags) : null,
     input.kpi_tier ?? null, input.kpi_stage ?? null, input.kpi_creator_content ?? null, input.kpi_ad_spend ?? null,
     input.products ? JSON.stringify(input.products) : null, input.creators ? JSON.stringify(input.creators) : null,
     input.accent ?? null, input.status ?? null, by]);
  if (!row) throw new Error("제안서 생성 실패");
  return row;
}

export async function deleteProposal(id: string): Promise<void> {
  await query("DELETE FROM proposal_docs WHERE id=$1", [id]);
}

// ── 템플릿(전역 디자인 기본값) ──
export async function listTemplates(): Promise<ProposalTemplate[]> {
  return query<ProposalTemplate>(
    "SELECT id, name, is_default, accent, agency_name, agency_logo_url, default_title, default_subtitle, sections FROM proposal_templates ORDER BY is_default DESC, updated_at DESC").catch(() => []);
}
export interface TemplateInput {
  id?: string; name?: string; accent?: string; agency_name?: string; agency_logo_url?: string | null;
  default_title?: string; default_subtitle?: string; sections?: string[]; is_default?: boolean;
}
export async function saveTemplate(input: TemplateInput, by: string): Promise<{ id: string }> {
  if (input.id) {
    const row = await queryOne<{ id: string }>(
      `UPDATE proposal_templates SET
         name=COALESCE($2,name), accent=COALESCE($3,accent), agency_name=COALESCE($4,agency_name),
         agency_logo_url=$5, default_title=COALESCE($6,default_title), default_subtitle=COALESCE($7,default_subtitle),
         sections=COALESCE($8::jsonb,sections), updated_by=$9, updated_at=now()
       WHERE id=$1 RETURNING id`,
      [input.id, input.name, input.accent, input.agency_name, input.agency_logo_url ?? null,
       input.default_title, input.default_subtitle, input.sections ? JSON.stringify(input.sections) : null, by]);
    if (!row) throw new Error("템플릿을 찾을 수 없습니다.");
    return row;
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO proposal_templates (name, accent, agency_name, agency_logo_url, default_title, default_subtitle, sections, is_default, updated_by)
     VALUES (COALESCE($1,'새 템플릿'),COALESCE($2,'#1f7a4d'),COALESCE($3,'DINO STUDIO'),$4,
       COALESCE($5,'틱톡샵 온보딩 및 마케팅 협업 제안서'),COALESCE($6,'크리에이터 커머스를 통한 브랜드 성장'),
       COALESCE($7::jsonb,'["cover","product","pricing","operations","kpi","creators","closing"]'),false,$8) RETURNING id`,
    [input.name, input.accent, input.agency_name, input.agency_logo_url ?? null, input.default_title, input.default_subtitle,
     input.sections ? JSON.stringify(input.sections) : null, by]);
  if (!row) throw new Error("템플릿 생성 실패");
  return row;
}

/** 브랜드로부터 제안서 초기값 프리필 — 이름·로고·트랙·제품 레퍼런스를 원장에서 끌어옴. */
export async function prefillFromBrand(brandId: string): Promise<ProposalInput> {
  const b = await queryOne<{ brand_name: string; contract_type: string | null; plan: string | null }>(
    "SELECT brand_name, contract_type, plan FROM brands WHERE id=$1", [brandId]).catch(() => null);
  const co = await queryOne<{ brand_logo_url: string | null }>(
    "SELECT brand_logo_url FROM brand_company WHERE brand_id=$1", [brandId]).catch(() => null);
  const prods = await query<{ name_kr: string; main_image_url: string | null; category: string | null }>(
    "SELECT name_kr, main_image_url, category FROM products_master WHERE brand_id=$1 AND status='active' ORDER BY created_at LIMIT 6", [brandId]).catch(() => []);
  const track = (b?.contract_type as string) || "onboarding";
  return {
    brand_id: brandId,
    brand_name: b?.brand_name ?? "",
    brand_logo_url: co?.brand_logo_url || null,
    track,
    products: prods.map((p) => ({ name: p.name_kr, image_url: p.main_image_url || undefined, desc: p.category || undefined })),
  };
}
