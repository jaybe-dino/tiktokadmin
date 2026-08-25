"use server";

// 제품·인증 화면 전용 서버액션.
// (@/app/actions.ts 는 수정 금지 규칙에 따라 이 화면 전용 파일로 분리)
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { aiText, aiEnabled } from "@/lib/ai";

export interface CertGuideResult {
  ok: boolean;
  error?: string;
  draft?: string;
  brandName?: string;
  productName?: string;
  country?: string;
  existingCount?: number;
}

/**
 * 인증 필요서류 AI 가이드 — 선택한 제품·국가 맥락으로 필요 인증·서류 체크리스트 초안을 생성.
 *   · 실데이터(products_master / brands / product_certs)로 맥락 구성.
 *   · 판정(등급·게이트·정산)은 하지 않고 문구·요약·제안만 생성한다.
 *   · 개인정보(카드·신분증·비밀번호)는 프롬프트/출력에 절대 포함하지 않는다.
 *   · 저장은 하지 않는다. 초안 텍스트만 반환(화면에서 검토용).
 */
export async function certGuideAction(input: {
  productId: string;
  country?: string;
}): Promise<CertGuideResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };

  const productId = (input.productId ?? "").trim();
  if (!productId) return { ok: false, error: "제품을 먼저 선택하세요." };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  const country = (input.country ?? "").trim().toUpperCase();

  // 제품 마스터 맥락 (실데이터)
  const prod = await queryOne<{
    name_kr: string;
    category: string | null;
    brand_name: string;
  }>(
    `SELECT pm.name_kr, pm.category, b.brand_name
       FROM products_master pm JOIN brands b ON b.id = pm.brand_id
      WHERE pm.id = $1`,
    [productId],
  ).catch(() => null);
  if (!prod) return { ok: false, error: "제품을 찾을 수 없습니다." };

  // 이미 확보/진행 중인 인증(서류) — 중복 제안 방지용. 개인정보 컬럼은 조회하지 않음.
  const certs = await query<{
    country: string | null;
    cert_type: string | null;
    status: string | null;
  }>(
    `SELECT country, cert_type, status
       FROM product_certs
      WHERE product_id = $1
        ${country ? "AND (upper(coalesce(country,'')) = $2 OR country IS NULL)" : ""}
      ORDER BY country NULLS FIRST, cert_type
      LIMIT 100`,
    country ? [productId, country] : [productId],
  ).catch(() => [] as { country: string | null; cert_type: string | null; status: string | null }[]);

  const existing = certs
    .map((c) => `- ${(c.country || "공통")} · ${(c.cert_type || "미상")} (상태: ${c.status || "미상"})`)
    .join("\n");

  const system = `너는 GloveK(틱톡샵 해외진출 대행사)의 인증·서류 코디네이터다.
선택한 제품과 대상 국가 맥락으로, 판매 전 갖춰야 할 "인증·필요서류 체크리스트 초안"을 한국어로 작성한다.
규칙:
- 등급 판정·발송 게이트·정산 금액 산정 같은 판정은 하지 말고, 필요 항목·서류·유의사항 등 문구/요약/제안만 작성한다.
- 이미 확보된 항목은 중복 제안하지 말고, 부족하거나 확인이 필요한 항목 위주로 제안한다.
- 규정은 국가·품목별로 다를 수 있으므로 확정 표현 대신 "확인 필요/일반적으로" 톤으로 안내한다.
- 개인정보(카드번호·신분증·비밀번호)는 절대 요청하거나 포함하지 않는다.
- 마크다운 헤딩 없이, 체크박스형 목록(- [ ] 항목 — 간단 설명)과 하단 유의사항 몇 줄만 출력한다. 머리말/메타설명 금지.`;

  const user = `제품: ${prod.brand_name} · ${prod.name_kr}
카테고리: ${prod.category || "미분류"}
대상 국가: ${country || "공통(국가 미지정)"}

이미 등록된 인증·서류(중복 제안 금지):
${existing || "(등록된 항목 없음)"}

위 맥락으로 이 제품을 해당 국가에서 판매하기 위한 인증·필요서류 체크리스트 초안을 작성해줘.`;

  const draft = await aiText({ system, user, maxTokens: 900 }).catch(() => null);
  if (!draft) return { ok: false, error: "AI 초안 생성 실패 (잠시 후 재시도)" };

  return {
    ok: true,
    draft: draft.trim(),
    brandName: prod.brand_name,
    productName: prod.name_kr,
    country: country || undefined,
    existingCount: certs.length,
  };
}

// ── 브랜드별 온보딩 신청 제품 열람·승인(제품 관리 포털 연동) ──────────────
import { revalidatePath } from "next/cache";
import {
  getApplicationIdForBrand, getProducts, getProductCountries, setProductApproval,
  type OnbProduct, type OnbProductCountry,
} from "@/lib/onboarding";

export interface BrandOnbProducts {
  ok: boolean;
  error?: string;
  appId?: string | null;
  products?: (OnbProduct & { countries: OnbProductCountry[] })[];
}

/** 브랜드 선택 → 그 브랜드가 신청서/제품포털에서 등록한 제품 목록(국가별 상세 포함). */
export async function getBrandOnbProductsAction(brandId: string): Promise<BrandOnbProducts> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!/^[0-9a-f-]{36}$/i.test(brandId)) return { ok: false, error: "잘못된 브랜드" };
  const appId = await getApplicationIdForBrand(brandId);
  if (!appId) return { ok: true, appId: null, products: [] };
  const products = await getProducts(appId);
  const out = [] as (OnbProduct & { countries: OnbProductCountry[] })[];
  for (const p of products) out.push({ ...p, countries: await getProductCountries(p.id) });
  return { ok: true, appId, products: out };
}

/** 제품 개별 승인/반려/대기 전환. 반려는 사유 필수. */
export async function setOnbProductApprovalAction(
  productId: string, status: "approved" | "rejected" | "pending", note: string,
): Promise<{ ok: boolean; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (status === "rejected" && !note.trim()) return { ok: false, error: "반려 사유를 입력하세요." };
  const r = await setProductApproval(productId, status, note.trim(), u.name || u.id);
  if (r.ok) { revalidatePath("/products"); revalidatePath("/apply/products"); }
  return r;
}
