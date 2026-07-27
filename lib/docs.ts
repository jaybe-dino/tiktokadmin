import { query } from "./db";
import type { ContractType } from "./types";

// 서류 체크리스트 템플릿 (01 doc_items). contract_done 도달 시 자동 생성.

interface DocTemplateItem {
  item_key: string;
  label: string;
  source?: "admin" | "apply_step";
  apply_step_no?: number;
}

export const DOC_TEMPLATES: Record<ContractType, DocTemplateItem[]> = {
  mall: [
    { item_key: "biz_reg", label: "사업자등록증" },
    { item_key: "trademark", label: "상표권(트레이드마크)" },
    { item_key: "gmail", label: "운영 Gmail 계정" },
    { item_key: "signup_form", label: "가입 신청서" },
    { item_key: "product_info", label: "상품 정보" },
    { item_key: "detail_translation", label: "상세페이지 번역" },
  ],
  onboarding: [
    { item_key: "biz_reg", label: "사업자등록증" },
    { item_key: "step1", label: "STEP1 · 기본정보", source: "apply_step", apply_step_no: 1 },
    { item_key: "step2", label: "STEP2 · UBO/이사", source: "apply_step", apply_step_no: 2 },
    { item_key: "step3", label: "STEP3 · 창고", source: "apply_step", apply_step_no: 3 },
    { item_key: "step4", label: "STEP4 · 국가별 인증", source: "apply_step", apply_step_no: 4 },
    { item_key: "step5", label: "STEP5 · 물류/최종", source: "apply_step", apply_step_no: 5 },
    { item_key: "logistics", label: "물류계약서" },
  ],
};

/** 템플릿 생성(멱등 — 이미 있으면 skip). */
export async function ensureDocTemplate(brandId: string, template: ContractType): Promise<void> {
  const items = DOC_TEMPLATES[template];
  for (const it of items) {
    await query(
      `INSERT INTO doc_items (brand_id, template, item_key, label, source, apply_step_no)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (brand_id, item_key) DO NOTHING`,
      [brandId, template, it.item_key, it.label, it.source ?? "admin", it.apply_step_no ?? null],
    );
  }
}

/** apply step 진행 동기화 (approved=done, rejected=미완). */
export async function syncApplyStep(
  brandId: string,
  stepNo: number,
  status: "submitted" | "approved" | "rejected",
): Promise<void> {
  const done = status === "approved";
  await query(
    `UPDATE doc_items
        SET done=$3, done_at = CASE WHEN $3 THEN now() ELSE NULL END,
            done_by = CASE WHEN $3 THEN 'apply_step' ELSE NULL END
      WHERE brand_id=$1 AND apply_step_no=$2 AND source='apply_step'`,
    [brandId, stepNo, done],
  );
}

export interface DocProgress {
  done: number;
  total: number;
  missing: string[];
  items: { item_key: string; label: string; done: boolean; source: string; apply_step_no: number | null }[];
}

export async function docProgress(brandId: string): Promise<DocProgress> {
  const items = await query<DocProgress["items"][number]>(
    `SELECT item_key, label, done, source, apply_step_no
       FROM doc_items WHERE brand_id=$1 ORDER BY item_key`,
    [brandId],
  );
  const done = items.filter((i) => i.done).length;
  return {
    done,
    total: items.length,
    missing: items.filter((i) => !i.done).map((i) => i.label),
    items,
  };
}
