import { query, tx } from "./db";
import { extractKeys, findBrand, hasDedupKey } from "./dedup";
import { recordStageHistory, setFields } from "./repo/brands";
import {
  GRADES, PAY_STATUSES, PLANS, STATES,
  type Brand, type Grade, type PayStatus, type Plan, type State,
} from "./types";

// 기존 데이터 적재(import). 리드 생성뿐 아니라 현재 단계·등급·플랜·결제·담당까지 반영.
// 데이터 로드이므로 게이트는 우회(현실 반영), 단 stage_history·brand_sources 에 감사 기록.

export interface ImportRecord {
  brand_name?: string;
  email?: string;
  phone?: string;
  biz_no?: string;
  contact_name?: string;
  category?: string;
  brand_url?: string;
  source?: string;
  state?: string;
  grade?: string;
  plan?: string;
  contract_type?: string;
  pay_status?: string;
  rec_track?: string;
  owner_intake?: string;
  owner_sales?: string;
  owner_onboard?: string;
  owner_ads?: string;
  next_action?: string;
  due_date?: string;
  memo?: string;
  countries?: string; // 콤마/세미콜론 구분
  glovek_user_id?: string;
  glovek_onb_id?: string;
}

function pick<T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined {
  const t = (v ?? "").trim();
  return t && (allowed as readonly string[]).includes(t) ? (t as T) : undefined;
}

function brandNameFrom(rec: ImportRecord): string {
  if (rec.brand_name?.trim()) return rec.brand_name.trim();
  if (rec.contact_name?.trim()) return `${rec.contact_name.trim()}(개인)`;
  if (rec.email?.trim()) return rec.email.split("@")[0];
  if (rec.phone?.trim()) return `phone:${rec.phone.replace(/\D/g, "").slice(-4)}`;
  return "(미상)";
}

export interface ImportResult {
  ok: boolean;
  brand_id?: string;
  created?: boolean;
  error?: string;
}

export async function importBrandRecord(actorId: string, rec: ImportRecord): Promise<ImportResult> {
  const keys = extractKeys(rec);
  if (!hasDedupKey(keys)) return { ok: false, error: "email/phone/biz_no 중 최소 하나 필요" };

  const state = pick<State>(rec.state, STATES);
  const grade = pick<Grade>(rec.grade, GRADES);
  const plan = pick<Plan>(rec.plan, PLANS);
  const payStatus = pick<PayStatus>(rec.pay_status, PAY_STATUSES);
  const contractType = pick(rec.contract_type, ["mall", "onboarding"] as const);
  const recTrack = pick(rec.rec_track, ["onboarding", "live"] as const);
  const countries = (rec.countries ?? "")
    .split(/[,;]/)
    .map((c) => c.trim())
    .filter(Boolean);

  // 잘못된 enum 값은 무시하지 않고 알림(데이터 정합성)
  if (rec.state && !state) return { ok: false, error: `잘못된 state: ${rec.state}` };
  if (rec.grade && !grade) return { ok: false, error: `잘못된 grade: ${rec.grade}` };
  if (rec.plan && !plan) return { ok: false, error: `잘못된 plan: ${rec.plan}` };
  if (rec.pay_status && !payStatus) return { ok: false, error: `잘못된 pay_status: ${rec.pay_status}` };

  // dedup: 찾거나 생성
  let created = false;
  const brand = await tx<Brand>(async (client) => {
    const found = await findBrand(client, keys);
    if (found) return found;
    created = true;
    const r = await client.query<Brand>(
      `INSERT INTO brands (brand_name, email, phone, biz_no, contact_name, category, brand_url, source, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        brandNameFrom(rec), keys.email, keys.phone, keys.biz_no,
        rec.contact_name ?? "", rec.category ?? "", rec.brand_url ?? "",
        rec.source || "etc", state || "lead_new",
      ],
    );
    return r.rows[0];
  });

  // 제공된 필드 반영(덮어쓰기 — 권위 있는 데이터 로드)
  const fields: Record<string, unknown> = {};
  const setIf = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") fields[k] = v;
  };
  setIf("brand_name", rec.brand_name?.trim());
  setIf("contact_name", rec.contact_name);
  setIf("category", rec.category);
  setIf("brand_url", rec.brand_url);
  setIf("source", rec.source);
  setIf("grade", grade);
  setIf("plan", plan);
  setIf("pay_status", payStatus);
  setIf("contract_type", contractType);
  setIf("rec_track", recTrack);
  setIf("owner_intake", rec.owner_intake);
  setIf("owner_sales", rec.owner_sales);
  setIf("owner_onboard", rec.owner_onboard);
  setIf("owner_ads", rec.owner_ads);
  setIf("next_action", rec.next_action);
  setIf("due_date", rec.due_date);
  setIf("memo", rec.memo);
  setIf("glovek_user_id", rec.glovek_user_id);
  setIf("glovek_onb_id", rec.glovek_onb_id);
  if (countries.length) fields.countries = countries;

  // state 변경(신규가 아니고 다른 단계면 이력 기록 + stage_entered_at 갱신)
  if (state && (created || state !== brand.state)) {
    fields.state = state;
    fields.stage_entered_at = new Date().toISOString();
  }

  if (Object.keys(fields).length) await setFields(brand.id, fields);

  if (state && !created && state !== brand.state) {
    await recordStageHistory(brand.id, brand.state, state, `admin:${actorId}(import)`, true, "import");
  }

  // 서류 체크리스트 보장 — import 로 contract_done 이상 단계로 올린 브랜드는 transitionBrand
  //   부수효과를 안 타므로 doc_items 가 비어 docs→setup 게이트에 영구 고립됨. 여기서 생성.
  const effectiveState = state ?? (brand.state as State);
  const { ordinal } = await import("./states");
  if (contractType && ordinal(effectiveState) >= ordinal("contract_done")) {
    const { ensureDocTemplate } = await import("./docs");
    await ensureDocTemplate(brand.id, contractType).catch(() => {});
  }

  // 소스 이력
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, source_ref, payload, occurred_at)
     VALUES ($1,'manual','import',$2,$3, now())
     ON CONFLICT (site, event, source_ref) DO NOTHING`,
    [brand.id, `import:${brand.id}:${Date.now()}`, JSON.stringify({ actor: actorId })],
  );

  return { ok: true, brand_id: brand.id, created };
}
