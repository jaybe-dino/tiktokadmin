// 제안서 문서(자동생성) 데이터 계층 — 공개 렌더(/proposal/[token]) + 어드민 빌더 공용.
import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";

export interface ProposalProduct { name: string; image_url?: string; desc?: string }
export interface ProposalCreator {
  handle: string; brand?: string; product?: string; revenue?: string; roas?: string;
  fee_rate?: string; engagement?: string; thumb_url?: string; caption?: string;
  link?: string; // 콘텐츠(틱톡) 링크 — 썸네일 클릭 시 이동
}
// v2(레퍼런스 데크) 서브 타입 — 전부 담당자 편집 가능.
export interface ProposalFeature { title: string; desc?: string }         // 핵심 SKU 특징 카드
export interface ProposalValueItem { label: string; qty?: string; amount: number } // 상당 구성 가치(amount=원)
export interface ProposalStep { title: string; desc?: string }            // 실행 로드맵 STEP
export interface ProposalImpact { title: string; desc?: string }          // 기대 효과
export interface ProposalAddon { label?: string; title: string; desc?: string }    // 별도 제안(애드온)

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
  accent2?: string | null; // 배경색(0091, BUG-21) — NULL 이면 기본 핑크·보라 계열
  // v2 — 레퍼런스 데크 정합 필드.
  product_en: string | null;
  product_volume: string | null;
  product_features: ProposalFeature[];
  product_tags: string[];
  value_items: ProposalValueItem[];
  value_total: number | null;
  roadmap_steps: ProposalStep[];
  impacts: ProposalImpact[];
  impact_banner: string | null;
  kpi_year_tier: string | null;
  kpi_year_stage: string | null;
  kpi_year_creator_content: number | null;
  kpi_year_ad_spend: string | null;
  addons: ProposalAddon[];
  status: "draft" | "published";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalTemplate {
  id: string; name: string; is_default: boolean; accent: string;
  agency_name: string; agency_logo_url: string | null;
  default_title: string; default_subtitle: string; sections: string[];
  contact_name: string | null; contact_title: string | null;
  contact_phone: string | null; contact_email: string | null;
}

const TRACK_LABEL: Record<string, string> = { onboarding: "ONBOARDING TRACK", mall: "MULTI-MALL TRACK", marketing: "MARKETING TRACK" };
export function trackLabel(t: string): string { return TRACK_LABEL[t] ?? t.toUpperCase(); }

const TEMPLATE_COLS = "id, name, is_default, accent, agency_name, agency_logo_url, default_title, default_subtitle, sections, contact_name, contact_title, contact_phone, contact_email";

export async function defaultTemplate(): Promise<ProposalTemplate | null> {
  return queryOne<ProposalTemplate>(
    `SELECT ${TEMPLATE_COLS} FROM proposal_templates WHERE is_default ORDER BY updated_at DESC LIMIT 1`,
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
  accent2?: string | null;
  // v2
  product_en?: string | null; product_volume?: string | null;
  product_features?: ProposalFeature[]; product_tags?: string[];
  value_items?: ProposalValueItem[]; value_total?: number | null;
  roadmap_steps?: ProposalStep[]; impacts?: ProposalImpact[]; impact_banner?: string | null;
  kpi_year_tier?: string | null; kpi_year_stage?: string | null;
  kpi_year_creator_content?: number | null; kpi_year_ad_spend?: string | null;
  addons?: ProposalAddon[];
  status?: "draft" | "published";
}

/** 생성/수정 upsert. id 있으면 수정, 없으면 생성(token 발급). */
export async function saveProposal(input: ProposalInput & { id?: string }, by: string): Promise<{ id: string; token: string }> {
  if (input.id) {
    const updSet = `
         title=COALESCE($2,title), subtitle=COALESCE($3,subtitle), brand_name=COALESCE($4,brand_name),
         brand_logo_url=$5, track=COALESCE($6,track),
         list_amount=$7, monthly_amount=$8, fee_pct=$9, term_months=$10, term_discount_pct=$11,
         features=COALESCE($12::jsonb,features), seeding_qty=$13, live_qty=$14, op_tags=COALESCE($15::jsonb,op_tags),
         kpi_tier=$16, kpi_stage=$17, kpi_creator_content=$18, kpi_ad_spend=$19,
         products=COALESCE($20::jsonb,products), creators=COALESCE($21::jsonb,creators),
         accent=$22, status=COALESCE($23,status),
         product_en=$24, product_volume=$25,
         product_features=COALESCE($26::jsonb,product_features), product_tags=COALESCE($27::jsonb,product_tags),
         value_items=COALESCE($28::jsonb,value_items), value_total=$29,
         roadmap_steps=COALESCE($30::jsonb,roadmap_steps), impacts=COALESCE($31::jsonb,impacts),
         impact_banner=$32,
         kpi_year_tier=$33, kpi_year_stage=$34,
         kpi_year_creator_content=$35, kpi_year_ad_spend=$36,
         addons=COALESCE($37::jsonb,addons)`;
    const updVals: unknown[] = [input.id, input.title, input.subtitle, input.brand_name, input.brand_logo_url ?? null, input.track,
       input.list_amount ?? null, input.monthly_amount ?? null, input.fee_pct ?? null, input.term_months ?? null, input.term_discount_pct ?? null,
       input.features ? JSON.stringify(input.features) : null, input.seeding_qty ?? null, input.live_qty ?? null, input.op_tags ? JSON.stringify(input.op_tags) : null,
       input.kpi_tier ?? null, input.kpi_stage ?? null, input.kpi_creator_content ?? null, input.kpi_ad_spend ?? null,
       input.products ? JSON.stringify(input.products) : null, input.creators ? JSON.stringify(input.creators) : null,
       input.accent ?? null, input.status ?? null,
       input.product_en ?? null, input.product_volume ?? null,
       input.product_features ? JSON.stringify(input.product_features) : null, input.product_tags ? JSON.stringify(input.product_tags) : null,
       input.value_items ? JSON.stringify(input.value_items) : null, input.value_total ?? null,
       input.roadmap_steps ? JSON.stringify(input.roadmap_steps) : null, input.impacts ? JSON.stringify(input.impacts) : null,
       input.impact_banner ?? null,
       input.kpi_year_tier ?? null, input.kpi_year_stage ?? null,
       input.kpi_year_creator_content ?? null, input.kpi_year_ad_spend ?? null,
       input.addons ? JSON.stringify(input.addons) : null];
    // 0091(accent2 배경색) 포함 저장 → 미적용 DB 는 컬럼 없이 폴백.
    let row: { id: string; token: string } | null;
    try {
      row = await queryOne<{ id: string; token: string }>(
        `UPDATE proposal_docs SET ${updSet}, accent2=$38, updated_at=now() WHERE id=$1 RETURNING id, token`,
        [...updVals, input.accent2 ?? null]);
    } catch (e) {
      if (!/accent2/.test(e instanceof Error ? e.message : "")) throw e;
      row = await queryOne<{ id: string; token: string }>(
        `UPDATE proposal_docs SET ${updSet}, updated_at=now() WHERE id=$1 RETURNING id, token`, updVals);
    }
    if (!row) throw new Error("제안서를 찾을 수 없습니다.");
    return row;
  }
  const token = randomBytes(9).toString("base64url");
  const row = await queryOne<{ id: string; token: string }>(
    `INSERT INTO proposal_docs
       (brand_id, token, title, subtitle, brand_name, brand_logo_url, track,
        list_amount, monthly_amount, fee_pct, term_months, term_discount_pct,
        features, seeding_qty, live_qty, op_tags, kpi_tier, kpi_stage, kpi_creator_content, kpi_ad_spend,
        products, creators, accent, status, created_by,
        product_en, product_volume, product_features, product_tags, value_items, value_total,
        roadmap_steps, impacts, impact_banner, kpi_year_tier, kpi_year_stage,
        kpi_year_creator_content, kpi_year_ad_spend, addons)
     VALUES ($1,$2,COALESCE($3,'틱톡샵 운영대행 제안서'),COALESCE($4,'크리에이터 커머스 운영대행을 통한 브랜드 성장'),
        COALESCE($5,''),$6,COALESCE($7,'onboarding'),
        $8,$9,$10,$11,$12,COALESCE($13::jsonb,'[]'),$14,$15,COALESCE($16::jsonb,'[]'),$17,$18,$19,$20,
        COALESCE($21::jsonb,'[]'),COALESCE($22::jsonb,'[]'),$23,COALESCE($24,'draft'),$25,
        $26,$27,COALESCE($28::jsonb,'[]'),COALESCE($29::jsonb,'[]'),COALESCE($30::jsonb,'[]'),$31,
        COALESCE($32::jsonb,'[]'),COALESCE($33::jsonb,'[]'),$34,$35,$36,$37,$38,COALESCE($39::jsonb,'[]'))
     RETURNING id, token`,
    [input.brand_id ?? null, token, input.title, input.subtitle, input.brand_name, input.brand_logo_url ?? null, input.track,
     input.list_amount ?? null, input.monthly_amount ?? null, input.fee_pct ?? null, input.term_months ?? null, input.term_discount_pct ?? null,
     input.features ? JSON.stringify(input.features) : null, input.seeding_qty ?? null, input.live_qty ?? null, input.op_tags ? JSON.stringify(input.op_tags) : null,
     input.kpi_tier ?? null, input.kpi_stage ?? null, input.kpi_creator_content ?? null, input.kpi_ad_spend ?? null,
     input.products ? JSON.stringify(input.products) : null, input.creators ? JSON.stringify(input.creators) : null,
     input.accent ?? null, input.status ?? null, by,
     input.product_en ?? null, input.product_volume ?? null,
     input.product_features ? JSON.stringify(input.product_features) : null, input.product_tags ? JSON.stringify(input.product_tags) : null,
     input.value_items ? JSON.stringify(input.value_items) : null, input.value_total ?? null,
     input.roadmap_steps ? JSON.stringify(input.roadmap_steps) : null, input.impacts ? JSON.stringify(input.impacts) : null,
     input.impact_banner ?? null, input.kpi_year_tier ?? null, input.kpi_year_stage ?? null,
     input.kpi_year_creator_content ?? null, input.kpi_year_ad_spend ?? null,
     input.addons ? JSON.stringify(input.addons) : null]);
  if (!row) throw new Error("제안서 생성 실패");
  return row;
}

export async function deleteProposal(id: string): Promise<void> {
  await query("DELETE FROM proposal_docs WHERE id=$1", [id]);
}

// ── 템플릿(전역 디자인 기본값) ──
export async function listTemplates(): Promise<ProposalTemplate[]> {
  return query<ProposalTemplate>(
    `SELECT ${TEMPLATE_COLS} FROM proposal_templates ORDER BY is_default DESC, updated_at DESC`).catch(() => []);
}
export interface TemplateInput {
  id?: string; name?: string; accent?: string; agency_name?: string; agency_logo_url?: string | null;
  default_title?: string; default_subtitle?: string; sections?: string[]; is_default?: boolean;
  contact_name?: string | null; contact_title?: string | null; contact_phone?: string | null; contact_email?: string | null;
}
export async function saveTemplate(input: TemplateInput, by: string): Promise<{ id: string }> {
  if (input.id) {
    const row = await queryOne<{ id: string }>(
      `UPDATE proposal_templates SET
         name=COALESCE($2,name), accent=COALESCE($3,accent), agency_name=COALESCE($4,agency_name),
         agency_logo_url=$5, default_title=COALESCE($6,default_title), default_subtitle=COALESCE($7,default_subtitle),
         sections=COALESCE($8::jsonb,sections),
         contact_name=$10, contact_title=$11, contact_phone=$12, contact_email=$13,
         updated_by=$9, updated_at=now()
       WHERE id=$1 RETURNING id`,
      [input.id, input.name, input.accent, input.agency_name, input.agency_logo_url ?? null,
       input.default_title, input.default_subtitle, input.sections ? JSON.stringify(input.sections) : null, by,
       input.contact_name ?? null, input.contact_title ?? null, input.contact_phone ?? null, input.contact_email ?? null]);
    if (!row) throw new Error("템플릿을 찾을 수 없습니다.");
    return row;
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO proposal_templates (name, accent, agency_name, agency_logo_url, default_title, default_subtitle, sections, is_default, updated_by)
     VALUES (COALESCE($1,'새 템플릿'),COALESCE($2,'#1f7a4d'),COALESCE($3,'DINO STUDIO'),$4,
       COALESCE($5,'틱톡샵 온보딩 및 마케팅 협업 제안서'),COALESCE($6,'크리에이터 커머스를 통한 브랜드 성장'),
       COALESCE($7::jsonb,'["cover","product","pricing","operations","kpi","addon","creators","closing"]'),false,$8) RETURNING id`,
    [input.name, input.accent, input.agency_name, input.agency_logo_url ?? null, input.default_title, input.default_subtitle,
     input.sections ? JSON.stringify(input.sections) : null, by]);
  if (!row) throw new Error("템플릿 생성 실패");
  return row;
}

// 온보딩 트랙 표준 구성(레퍼런스 데크 기준) — 담당자·AI 가 편집할 "기본 내용" 스캐폴딩.
//   금액은 상당 구성 가치 명세(합계 500만 상당) · 실제 견적은 pricing 필드로 별도 관리.
export const ONBOARDING_DEFAULTS = {
  list_amount: 5_000_000,
  monthly_amount: 2_000_000,
  fee_pct: 10,
  seeding_qty: 20,
  live_qty: 4,
  features: ["시딩 20건 · 라이브 4건", "인증 · 물류 관리", "마케팅 전략 컨설팅", "전담 CS · 발주 관리", "제품 등록 번역 초안"],
  op_tags: ["인증물류", "마케팅컨설팅", "전담CS", "전담발주", "번역초안"],
  // 개별 단가는 공개 제안서에 표기하지 않음(합계 상당만 노출) — qty 는 수량만.
  value_items: [
    { label: "시딩", qty: "20건", amount: 600_000 },
    { label: "라이브 커머스", qty: "4건", amount: 400_000 },
    { label: "인증 · 물류 관리", amount: 500_000 },
    { label: "마케팅 전략 컨설팅", amount: 1_000_000 },
    { label: "전담 CS 매니저", amount: 1_000_000 },
    { label: "전담 발주 관리", amount: 1_000_000 },
    { label: "제품 등록 번역 초안", amount: 500_000 },
  ] as ProposalValueItem[],
  value_total: 5_000_000,
  roadmap_steps: [
    { title: "온보딩 세팅", desc: "인증 · 물류 · 번역 · 스토어 세팅" },
    { title: "콘텐츠 · 시딩", desc: "크리에이터 시딩 20건 배포" },
    { title: "라이브 커머스", desc: "라이브 4건 운영 · 전환" },
    { title: "성장 · 운영", desc: "GMV 성장 · CS · 발주 상시" },
  ] as ProposalStep[],
  impacts: [
    { title: "초기 GMV 확보", desc: "시딩 · 라이브 동시 운영으로 초기 매출 기반 확보" },
    { title: "운영 부담 최소화", desc: "인증 · 물류 · CS · 발주 대행으로 리소스 절감" },
    { title: "채널 안착 & 성장", desc: "콘텐츠 자산 · 현지화로 지속 성장 기반 구축" },
  ] as ProposalImpact[],
  impact_banner: "월 200만원으로 틱톡샵 진출을 시작하세요.",
  kpi_tier: "T1",
  kpi_stage: "진입 · 초기 안착 단계",
  kpi_creator_content: 204,
  kpi_ad_spend: "$1.4K",
  kpi_year_tier: "T2",
  kpi_year_stage: "성장 · 스케일업 단계",
  kpi_year_creator_content: 992,
  kpi_year_ad_spend: "$14K",
  addons: [
    { label: "PERFORMANCE ADS", title: "GMV 광고 (Ads)", desc: "GMV 성장 가속을 위한 유가 광고 집행. 초기 오가닉 성과 데이터를 기반으로 예산 · 소재 전략을 별도 설계합니다." },
    { label: "PAID SEEDING", title: "유가 시딩", desc: "기본 무상 시딩을 넘어 규모 · 화력을 확대하는 유료 크리에이터 협업. 목표 티어 · 콘텐츠 볼륨에 맞춰 별도 산정합니다." },
  ] as ProposalAddon[],
};

/** 브랜드로부터 제안서 초기값 프리필 — 이름·로고·트랙·제품 레퍼런스 + 온보딩 표준 구성 스캐폴딩. */
export async function prefillFromBrand(brandId: string): Promise<ProposalInput> {
  const b = await queryOne<{ brand_name: string; contract_type: string | null; plan: string | null }>(
    "SELECT brand_name, contract_type, plan FROM brands WHERE id=$1", [brandId]).catch(() => null);
  const co = await queryOne<{ brand_logo_url: string | null }>(
    "SELECT brand_logo_url FROM brand_company WHERE brand_id=$1", [brandId]).catch(() => null);
  const prods = await query<{ name_kr: string; main_image_url: string | null; category: string | null }>(
    "SELECT name_kr, main_image_url, category FROM products_master WHERE brand_id=$1 AND status='active' ORDER BY created_at LIMIT 6", [brandId]).catch(() => []);
  const track = (b?.contract_type as string) || "onboarding";
  const p0 = prods[0];
  return {
    brand_id: brandId,
    brand_name: b?.brand_name ?? "",
    brand_logo_url: co?.brand_logo_url || null,
    track,
    products: prods.map((p) => ({ name: p.name_kr, image_url: p.main_image_url || undefined, desc: p.category || undefined })),
    // 히어로 제품(첫 제품 기준) + 온보딩 트랙 표준 구성 — 담당자/AI 편집용 기본값.
    product_tags: p0?.category ? [p0.category] : [],
    ...(track === "onboarding" ? ONBOARDING_DEFAULTS : {}),
  };
}
