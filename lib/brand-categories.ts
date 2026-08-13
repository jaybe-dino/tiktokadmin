// 브랜드 카테고리 목록 — 브랜드360 셀렉트 + 설정 관리. 0069 미적용 시 기본값 폴백.
import { query } from "./db";

export interface BrandCategory { id: string; name: string; sort_order: number; active: boolean; }

const DEFAULTS = ["스킨케어", "색조", "더마"];

/** 활성 카테고리 이름 목록(정렬순). 테이블 없거나 비면 기본값. */
export async function listCategoryNames(): Promise<string[]> {
  const rows = await query<{ name: string }>(
    "SELECT name FROM brand_categories WHERE active ORDER BY sort_order, name",
  ).catch(() => [] as { name: string }[]);
  if (rows.length === 0) return [...DEFAULTS];
  return rows.map((r) => r.name);
}

/** 관리용 — 비활성 포함 전체. */
export async function listBrandCategories(): Promise<BrandCategory[]> {
  return query<BrandCategory>(
    "SELECT id, name, sort_order, active FROM brand_categories ORDER BY sort_order, name",
  ).catch(() => [] as BrandCategory[]);
}

/** 카테고리 추가(멱등). 다음 정렬순번 부여. */
export async function addBrandCategory(name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  await query(
    `INSERT INTO brand_categories (name, sort_order)
     VALUES ($1, COALESCE((SELECT max(sort_order)+1 FROM brand_categories), 1))
     ON CONFLICT (name) DO UPDATE SET active=true`,
    [n],
  );
}

/** 카테고리 삭제(사용 중이어도 브랜드 값 자체는 유지 — 목록에서만 제거). */
export async function removeBrandCategory(id: string): Promise<void> {
  await query("DELETE FROM brand_categories WHERE id=$1", [id]);
}
