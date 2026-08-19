// 마케팅 제안서 문서 저장/조회 (mkt_proposal_docs). 예산 입력값 저장 → 렌더 시 엔진 재계산.
import { randomUUID } from "node:crypto";
import { query, queryOne } from "./db";
import type { MktCountry } from "./mkt-proposal-engine";

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
  created_by: string | null;
  created_at: string;
  updated_at: string;
  brand_name?: string;
}

const COLS =
  "d.id, d.brand_id, d.mkt_project_id, d.token, d.title, d.subtitle, d.status, d.products_json, d.track, d.goal_first, d.goal_final, " +
  "d.countries, d.start_month, d.months, d.monthly_budget, d.operation_fee, d.gmv_reserve_min, d.gmv_reserve_max, " +
  "d.first_month_seeding, d.commission_pct, d.references_json, d.intro_note, d.accent, d.created_by, d.created_at, d.updated_at";

export async function listMktProposals(brandId?: string): Promise<MktProposalDocRow[]> {
  const where = brandId ? "WHERE d.brand_id=$1" : "";
  const args = brandId ? [brandId] : [];
  return query<MktProposalDocRow>(
    `SELECT ${COLS}, b.brand_name FROM mkt_proposal_docs d LEFT JOIN brands b ON b.id=d.brand_id ${where} ORDER BY d.created_at DESC LIMIT 200`,
    args,
  ).catch(() => []);
}

export async function getMktProposalById(id: string): Promise<MktProposalDocRow | null> {
  return queryOne<MktProposalDocRow>(
    `SELECT ${COLS}, b.brand_name FROM mkt_proposal_docs d LEFT JOIN brands b ON b.id=d.brand_id WHERE d.id=$1`, [id],
  ).catch(() => null);
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
}

const VALID_COUNTRIES: MktCountry[] = ["US", "TH", "VN"];
const cleanCountries = (arr?: string[]): string[] => {
  const out = (arr ?? []).filter((c): c is MktCountry => VALID_COUNTRIES.includes(c as MktCountry));
  return out.length ? out : ["US"];
};

export async function saveMktProposal(input: MktProposalInput, by: string): Promise<{ id: string; token: string }> {
  const countries = cleanCountries(input.countries);
  const startMonth = Math.min(12, Math.max(1, Number(input.start_month ?? 9) || 9));
  const months = Math.min(12, Math.max(1, Number(input.months ?? 6) || 6));

  if (input.id) {
    const row = await queryOne<{ token: string }>(
      `UPDATE mkt_proposal_docs SET
         brand_id=$2, mkt_project_id=$3, title=$4, subtitle=$5, status=$6,
         products_json=$7, track=$8, goal_first=$9, goal_final=$10,
         countries=$11, start_month=$12, months=$13, monthly_budget=$14, operation_fee=$15,
         gmv_reserve_min=$16, gmv_reserve_max=$17, first_month_seeding=$18, commission_pct=$19,
         references_json=$20, intro_note=$21, accent=$22, updated_at=now()
       WHERE id=$1 RETURNING token`,
      [
        input.id, input.brand_id, input.mkt_project_id ?? null, input.title, input.subtitle ?? "", input.status ?? "draft",
        JSON.stringify(input.products_json ?? []), input.track ?? "standard", input.goal_first ?? "", input.goal_final ?? "",
        countries, startMonth, months, Math.round(Number(input.monthly_budget ?? 0)), Math.round(Number(input.operation_fee ?? 1500000)),
        Math.round(Number(input.gmv_reserve_min ?? 1000000)), Math.round(Number(input.gmv_reserve_max ?? 3000000)),
        input.first_month_seeding ?? true, Number(input.commission_pct ?? 10),
        JSON.stringify(input.references_json ?? []), input.intro_note ?? "", input.accent ?? "#111111",
      ],
    );
    return { id: input.id, token: row!.token };
  }

  const token = `mp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const row = await queryOne<{ id: string; token: string }>(
    `INSERT INTO mkt_proposal_docs
       (brand_id, mkt_project_id, token, title, subtitle, status, products_json, track, goal_first, goal_final,
        countries, start_month, months, monthly_budget, operation_fee, gmv_reserve_min, gmv_reserve_max,
        first_month_seeding, commission_pct, references_json, intro_note, accent, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING id, token`,
    [
      input.brand_id, input.mkt_project_id ?? null, token, input.title, input.subtitle ?? "", input.status ?? "draft",
      JSON.stringify(input.products_json ?? []), input.track ?? "standard", input.goal_first ?? "", input.goal_final ?? "",
      countries, startMonth, months, Math.round(Number(input.monthly_budget ?? 5000000)), Math.round(Number(input.operation_fee ?? 1500000)),
      Math.round(Number(input.gmv_reserve_min ?? 1000000)), Math.round(Number(input.gmv_reserve_max ?? 3000000)),
      input.first_month_seeding ?? true, Number(input.commission_pct ?? 10),
      JSON.stringify(input.references_json ?? []), input.intro_note ?? "", input.accent ?? "#111111", by,
    ],
  );
  return { id: row!.id, token: row!.token };
}

export async function deleteMktProposal(id: string): Promise<void> {
  await query("DELETE FROM mkt_proposal_docs WHERE id=$1", [id]);
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
