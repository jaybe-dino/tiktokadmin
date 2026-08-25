// 마케팅 제안서 문서 저장/조회 (mkt_proposal_docs). 예산 입력값 저장 → 렌더 시 엔진 재계산.
import { randomUUID } from "node:crypto";
import { query, queryOne } from "./db";
import type { MktCountry, PhaseRatios, MonthOverride } from "./mkt-proposal-engine";

export interface MktProductItem { name: string; name_en?: string; volume?: string; image_url?: string; features?: string[] }
export interface MktReferenceItem {
  creator?: string; product?: string; gmv?: string; roas?: string;
  commission?: string; engagement?: string; desc?: string; image_url?: string;
}

export interface MktProposalDocRow {
  id: string;
  brand_id: string | null;
  mkt_project_id: string | null;
  token: string;
  title: string;
  subtitle: string;
  status: "draft" | "sent" | "accepted" | "rejected";
  products_json: MktProductItem[];
  track: string;
  goal_first: string;
  goal_final: string;
  countries: string[];
  start_month: number;
  months: number;
  monthly_budget: number;
  operation_fee: number;
  gmv_reserve_min: number;
  gmv_reserve_max: number;
  first_month_seeding: boolean;
  commission_pct: number;
  references_json: MktReferenceItem[];
  intro_note: string;
  accent: string;
  accent2: string;
  show_bundle_slide: boolean;
  phase_ratios_json: Partial<PhaseRatios>;
  month_overrides_json: (MonthOverride | null)[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  brand_name?: string;
  // 생성방식 구분(0087) — null=기존(수동, /mkt-proposals), 'survey_auto'=설문 자동생성(/mkt-proposals2).
  gen_source?: string | null;
  // 제품 카테고리(0089, "대분류 > 소분류") — glovek 레퍼런스 조회 기준.
  category?: string | null;
}

const COLS =
  "d.id, d.brand_id, d.mkt_project_id, d.token, d.title, d.subtitle, d.status, d.products_json, d.track, d.goal_first, d.goal_final, " +
  "d.countries, d.start_month, d.months, d.monthly_budget, d.operation_fee, d.gmv_reserve_min, d.gmv_reserve_max, " +
  "d.first_month_seeding, d.commission_pct, d.references_json, d.intro_note, d.accent, d.accent2, d.show_bundle_slide, " +
  "d.phase_ratios_json, d.month_overrides_json, d.created_by, d.created_at, d.updated_at";

export async function listMktProposals(opts?: { brandId?: string; genSource?: "auto" | "manual" }): Promise<MktProposalDocRow[]> {
  const where: string[] = [];
  const args: string[] = [];
  if (opts?.brandId) { args.push(opts.brandId); where.push(`d.brand_id=$${args.length}`); }
  if (opts?.genSource === "auto") where.push(`d.gen_source='survey_auto'`);
  if (opts?.genSource === "manual") where.push(`d.gen_source IS NULL`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // 0087(gen_source)·0089(category) 미적용 DB 방어 — 컬럼 없으면 필터 없이 폴백.
  return query<MktProposalDocRow>(
    `SELECT ${COLS}, d.gen_source, d.category, b.brand_name FROM mkt_proposal_docs d LEFT JOIN brands b ON b.id=d.brand_id ${whereSql} ORDER BY d.created_at DESC LIMIT 200`,
    args,
  ).catch(() =>
    query<MktProposalDocRow>(
      `SELECT ${COLS}, b.brand_name FROM mkt_proposal_docs d LEFT JOIN brands b ON b.id=d.brand_id ${opts?.brandId ? "WHERE d.brand_id=$1" : ""} ORDER BY d.created_at DESC LIMIT 200`,
      opts?.brandId ? [opts.brandId] : [],
    ).catch(() => []),
  );
}

export async function getMktProposalById(id: string): Promise<MktProposalDocRow | null> {
  return queryOne<MktProposalDocRow>(
    `SELECT ${COLS}, d.gen_source, d.category, b.brand_name FROM mkt_proposal_docs d LEFT JOIN brands b ON b.id=d.brand_id WHERE d.id=$1`, [id],
  ).catch(() =>
    queryOne<MktProposalDocRow>(`SELECT ${COLS}, b.brand_name FROM mkt_proposal_docs d LEFT JOIN brands b ON b.id=d.brand_id WHERE d.id=$1`, [id]).catch(() => null),
  );
}

export async function getMktProposalByToken(token: string): Promise<MktProposalDocRow | null> {
  return queryOne<MktProposalDocRow>(
    `SELECT ${COLS}, b.brand_name FROM mkt_proposal_docs d LEFT JOIN brands b ON b.id=d.brand_id WHERE d.token=$1`, [token],
  ).catch(() => null);
}

export interface MktProposalInput {
  id?: string;
  brand_id: string | null;
  mkt_project_id?: string | null;
  title: string;
  subtitle?: string;
  status?: "draft" | "sent" | "accepted" | "rejected";
  products_json?: MktProductItem[];
  track?: string;
  goal_first?: string;
  goal_final?: string;
  countries?: string[];
  start_month?: number;
  months?: number;
  monthly_budget?: number;
  operation_fee?: number;
  gmv_reserve_min?: number;
  gmv_reserve_max?: number;
  first_month_seeding?: boolean;
  commission_pct?: number;
  references_json?: MktReferenceItem[];
  intro_note?: string;
  accent?: string;
  accent2?: string;
  show_bundle_slide?: boolean;
  phase_ratios_json?: Partial<PhaseRatios>;
  month_overrides_json?: (MonthOverride | null)[];
  gen_source?: string | null; // 신규 생성 시에만 반영(수정 시에는 변경하지 않음).
  category?: string; // 제품 카테고리("대분류 > 소분류") — 0089.
}

const VALID_COUNTRIES: MktCountry[] = ["US", "TH", "VN", "PH", "MY", "SG"];
const cleanCountries = (arr?: string[]): string[] => {
  const out = (arr ?? []).filter((c): c is MktCountry => VALID_COUNTRIES.includes(c as MktCountry));
  return out.length ? out : ["US"];
};

export async function saveMktProposal(input: MktProposalInput, by: string): Promise<{ id: string; token: string }> {
  const countries = cleanCountries(input.countries);
  const startMonth = Math.min(12, Math.max(1, Number(input.start_month ?? 9) || 9));
  const months = Math.min(12, Math.max(1, Number(input.months ?? 6) || 6));

  if (input.id) {
    const updVals = [
      input.id, input.brand_id, input.mkt_project_id ?? null, input.title, input.subtitle ?? "", input.status ?? "draft",
      JSON.stringify(input.products_json ?? []), input.track ?? "standard", input.goal_first ?? "", input.goal_final ?? "",
      countries, startMonth, months, Math.round(Number(input.monthly_budget ?? 0)), Math.round(Number(input.operation_fee ?? 1500000)),
      Math.round(Number(input.gmv_reserve_min ?? 1000000)), Math.round(Number(input.gmv_reserve_max ?? 3000000)),
      input.first_month_seeding ?? true, Number(input.commission_pct ?? 10),
      JSON.stringify(input.references_json ?? []), input.intro_note ?? "", input.accent ?? "#111111",
      JSON.stringify(input.phase_ratios_json ?? {}), JSON.stringify(input.month_overrides_json ?? []),
      input.accent2 ?? "#0b1220", input.show_bundle_slide ?? true,
    ];
    const updSet =
      `brand_id=$2, mkt_project_id=$3, title=$4, subtitle=$5, status=$6,
       products_json=$7, track=$8, goal_first=$9, goal_final=$10,
       countries=$11, start_month=$12, months=$13, monthly_budget=$14, operation_fee=$15,
       gmv_reserve_min=$16, gmv_reserve_max=$17, first_month_seeding=$18, commission_pct=$19,
       references_json=$20, intro_note=$21, accent=$22,
       phase_ratios_json=$23, month_overrides_json=$24, accent2=$25, show_bundle_slide=$26`;
    let row: { token: string } | null;
    try {
      // 0089(category) 포함 — 미적용 DB 는 컬럼 없이 폴백.
      row = await queryOne<{ token: string }>(
        `UPDATE mkt_proposal_docs SET ${updSet}, category=$27, updated_at=now() WHERE id=$1 RETURNING token`,
        [...updVals, input.category ?? ""],
      );
    } catch (e) {
      if (!/category/.test(e instanceof Error ? e.message : "")) throw e;
      row = await queryOne<{ token: string }>(
        `UPDATE mkt_proposal_docs SET ${updSet}, updated_at=now() WHERE id=$1 RETURNING token`, updVals,
      );
    }
    return { id: input.id, token: row!.token };
  }

  const token = `mp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const insVals = [
    input.brand_id, input.mkt_project_id ?? null, token, input.title, input.subtitle ?? "", input.status ?? "draft",
    JSON.stringify(input.products_json ?? []), input.track ?? "standard", input.goal_first ?? "", input.goal_final ?? "",
    countries, startMonth, months, Math.round(Number(input.monthly_budget ?? 5000000)), Math.round(Number(input.operation_fee ?? 1500000)),
    Math.round(Number(input.gmv_reserve_min ?? 1000000)), Math.round(Number(input.gmv_reserve_max ?? 3000000)),
    input.first_month_seeding ?? true, Number(input.commission_pct ?? 10),
    JSON.stringify(input.references_json ?? []), input.intro_note ?? "", input.accent ?? "#111111",
    JSON.stringify(input.phase_ratios_json ?? {}), JSON.stringify(input.month_overrides_json ?? []),
    input.accent2 ?? "#0b1220", input.show_bundle_slide ?? true, by,
  ];
  const insCols =
    `brand_id, mkt_project_id, token, title, subtitle, status, products_json, track, goal_first, goal_final,
     countries, start_month, months, monthly_budget, operation_fee, gmv_reserve_min, gmv_reserve_max,
     first_month_seeding, commission_pct, references_json, intro_note, accent, phase_ratios_json, month_overrides_json,
     accent2, show_bundle_slide, created_by`;
  const ph = (n: number) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(",");
  const insert = (extraCols: string[], extraVals: unknown[]) =>
    queryOne<{ id: string; token: string }>(
      `INSERT INTO mkt_proposal_docs (${insCols}${extraCols.length ? ", " + extraCols.join(", ") : ""})
       VALUES (${ph(insVals.length + extraVals.length)}) RETURNING id, token`,
      [...insVals, ...extraVals],
    );
  // 0087(gen_source)·0089(category) 미적용 DB 방어 — 없는 컬럼을 단계적으로 제외하고 재시도.
  let row: { id: string; token: string } | null;
  try {
    row = await insert(["gen_source", "category"], [input.gen_source ?? null, input.category ?? ""]);
  } catch (e1) {
    const m1 = e1 instanceof Error ? e1.message : "";
    if (/category/.test(m1)) {
      try {
        row = await insert(["gen_source"], [input.gen_source ?? null]);
      } catch (e2) {
        if (!/gen_source/.test(e2 instanceof Error ? e2.message : "")) throw e2;
        row = await insert([], []);
      }
    } else if (/gen_source/.test(m1)) {
      row = await insert([], []);
    } else {
      throw e1;
    }
  }
  return { id: row!.id, token: row!.token };
}

export async function deleteMktProposal(id: string): Promise<void> {
  await query("DELETE FROM mkt_proposal_docs WHERE id=$1", [id]);
}

// ── 제안서 템플릿 (디자인·예산·국가·비율 등 설정 저장/불러오기) ──
// 브랜드·제목·제품·레퍼런스 등 개별값은 제외한 '틀'만 저장.
export type MktTemplateConfig = Pick<MktProposalInput,
  "subtitle" | "track" | "accent" | "accent2" | "show_bundle_slide" |
  "countries" | "start_month" | "months" | "monthly_budget" | "operation_fee" |
  "gmv_reserve_min" | "gmv_reserve_max" | "first_month_seeding" | "commission_pct" |
  "goal_first" | "goal_final" | "phase_ratios_json" | "intro_note">;

export interface MktTemplateRow { id: string; name: string; config: MktTemplateConfig; created_at: string }

export async function listMktTemplates(): Promise<MktTemplateRow[]> {
  return query<MktTemplateRow>(
    "SELECT id, name, config, created_at FROM mkt_proposal_templates ORDER BY created_at DESC LIMIT 100",
  ).catch(() => []);
}
export async function getMktTemplate(id: string): Promise<MktTemplateRow | null> {
  return queryOne<MktTemplateRow>("SELECT id, name, config, created_at FROM mkt_proposal_templates WHERE id=$1", [id]).catch(() => null);
}
export async function saveMktTemplate(name: string, config: MktTemplateConfig, by: string): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    "INSERT INTO mkt_proposal_templates (name, config, created_by) VALUES ($1,$2,$3) RETURNING id",
    [name.trim() || "제안서 템플릿", JSON.stringify(config ?? {}), by],
  );
  return { id: row!.id };
}
export async function deleteMktTemplate(id: string): Promise<void> {
  await query("DELETE FROM mkt_proposal_templates WHERE id=$1", [id]);
}
/** 현재 문서에서 템플릿 설정만 추출. */
export function templateConfigFromDoc(d: MktProposalDocRow): MktTemplateConfig {
  return {
    subtitle: d.subtitle, track: d.track, accent: d.accent, accent2: d.accent2, show_bundle_slide: d.show_bundle_slide,
    countries: d.countries, start_month: d.start_month, months: d.months, monthly_budget: d.monthly_budget,
    operation_fee: d.operation_fee, gmv_reserve_min: d.gmv_reserve_min, gmv_reserve_max: d.gmv_reserve_max,
    first_month_seeding: d.first_month_seeding, commission_pct: d.commission_pct,
    goal_first: d.goal_first, goal_final: d.goal_final, phase_ratios_json: d.phase_ratios_json, intro_note: d.intro_note,
  };
}

/** 브랜드로 프리필(제목·제품 등 기본값). */
export async function prefillMktProposal(brandId: string): Promise<MktProposalInput> {
  const b = await queryOne<{ brand_name: string; category: string | null }>(
    "SELECT brand_name, category FROM brands WHERE id=$1", [brandId],
  ).catch(() => null);
  const products = await query<{ name_kr: string; name_en: string | null; main_image_url: string | null }>(
    "SELECT name_kr, name_en, main_image_url FROM products_master WHERE brand_id=$1 ORDER BY created_at LIMIT 3", [brandId],
  ).catch(() => []);
  const name = b?.brand_name ?? "브랜드";
  return {
    brand_id: brandId,
    title: `${name} 마케팅 협업 제안서`,
    subtitle: "TikTok Shop GMV 성장 전략 제안",
    products_json: products.map((p) => ({ name: p.name_kr, name_en: p.name_en ?? "", image_url: p.main_image_url ?? "", features: [] })),
    track: "standard",
    countries: ["US"],
    start_month: 9,
    months: 6,
    monthly_budget: 5000000,
    operation_fee: 1500000,
    gmv_reserve_min: 1000000,
    gmv_reserve_max: 3000000,
    first_month_seeding: true,
    commission_pct: 10,
  };
}
