// 진행국가 통합 — 여러 소스(운영견적·온보딩 KYC·물류·목표국)에서 국가를 모아 한글 라벨로 합산.
//   같은 국가가 여러 번 입력돼도 dedupe. 브랜드360 표기 + 원장 필터 공용 원천.
import { query } from "./db";

// 국가 코드 ↔ 한글 라벨(운영견적·물류·온보딩 코드 정규화). 라벨 표기는 원장/목표국과 통일.
export const COUNTRY_CODE_LABEL: Record<string, string> = {
  US: "미국", JP: "일본", TH: "태국", PH: "필리핀", MY: "말레이시아", SG: "싱가포르",
  VN: "베트남", TW: "대만", ID: "인도네시아", KR: "한국", CN: "중국", HK: "홍콩",
};
// 라벨 변형 정규화(싱가폴→싱가포르 등).
const LABEL_ALIAS: Record<string, string> = { "싱가폴": "싱가포르" };

export function normCountry(v: string): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  if (COUNTRY_CODE_LABEL[s.toUpperCase()]) return COUNTRY_CODE_LABEL[s.toUpperCase()];
  return LABEL_ALIAS[s] ?? s;
}

/** 라벨 → 코드(역매핑). 없으면 "". */
export function codeForLabel(label: string): string {
  const norm = normCountry(label);
  for (const [code, l] of Object.entries(COUNTRY_CODE_LABEL)) if (l === norm) return code;
  return "";
}

/** 브랜드 진행국가(한글 라벨) 통합 — 목표국·운영견적·온보딩·물류 union(중복 제거). */
export async function aggregateProgressCountries(brandId: string): Promise<string[]> {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => { const n = normCountry(String(v ?? "")); if (n) out.add(n); };

  const rows = await query<{ src: string; val: string }>(
    `SELECT 'brand' src, unnest(coalesce(b.countries,'{}')) val FROM brands b WHERE b.id=$1
     UNION ALL
     SELECT 'quote', unnest(coalesce(p.countries,'{}')) FROM proposals p WHERE p.brand_id=$1 AND p.countries IS NOT NULL
     UNION ALL
     SELECT 'logi', lc.country FROM logistics_contracts lc WHERE lc.brand_id=$1
     UNION ALL
     SELECT 'onb', coalesce(nullif(oc.country_name,''), oc.country_code)
       FROM onb_applications oa JOIN onb_countries oc ON oc.application_id=oa.id WHERE oa.brand_id=$1`,
    [brandId],
  ).catch(() => [] as { src: string; val: string }[]);
  for (const r of rows) add(r.val);
  return [...out].sort();
}
