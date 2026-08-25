// 제품 카테고리 체계(대분류 > 소분류) — 마케팅·운영대행 제안서의 glovek 유사 콘텐츠 조회 기준.
//   저장 형식: "스킨케어 > 크림" (소분류 없으면 "스킨케어"). 순수 상수/함수 — 클라이언트 import 가능.

export const PRODUCT_CATEGORIES: { main: string; subs: string[] }[] = [
  { main: "스킨케어", subs: ["크림", "세럼·앰플", "토너·스킨", "로션·에멀전", "클렌저", "마스크팩", "선케어", "미스트", "아이케어"] },
  { main: "메이크업", subs: ["립", "베이스·쿠션", "아이", "치크", "네일"] },
  { main: "헤어", subs: ["샴푸·트리트먼트", "헤어에센스·오일", "염색·펌", "두피케어"] },
  { main: "바디", subs: ["바디워시", "바디로션·크림", "핸드·풋", "데오드란트", "제모"] },
  { main: "향수·프래그런스", subs: ["향수", "룸스프레이·디퓨저"] },
  { main: "건강기능식품", subs: ["비타민", "유산균", "콜라겐", "오메가3", "다이어트", "홍삼·인삼"] },
  { main: "식품", subs: ["스낵", "음료", "간편식", "건강식품", "김·해조류"] },
  { main: "생활·리빙", subs: ["주방", "세탁·청소", "욕실", "수납·정리"] },
  { main: "패션·잡화", subs: ["의류", "가방", "액세서리", "신발"] },
  { main: "유아·키즈", subs: ["기저귀·물티슈", "유아 스킨케어", "완구", "유아식"] },
  { main: "반려동물", subs: ["사료·간식", "위생·미용", "용품"] },
  { main: "전자·기기", subs: ["뷰티디바이스", "생활가전", "액세서리"] },
];

export const CATEGORY_SEP = " > ";

export function joinCategory(main: string, sub?: string): string {
  const m = (main ?? "").trim();
  const s = (sub ?? "").trim();
  return m ? (s ? `${m}${CATEGORY_SEP}${s}` : m) : "";
}

export function splitCategory(v: string | null | undefined): { main: string; sub: string } {
  const raw = (v ?? "").trim();
  if (!raw) return { main: "", sub: "" };
  const idx = raw.indexOf(CATEGORY_SEP);
  if (idx < 0) return { main: raw, sub: "" };
  return { main: raw.slice(0, idx).trim(), sub: raw.slice(idx + CATEGORY_SEP.length).trim() };
}

/** glovek 검색어 우선순위 — 소분류(세부) 먼저, 매칭 없으면 대분류 폴백용. */
export function categorySearchTerms(v: string | null | undefined): string[] {
  const { main, sub } = splitCategory(v);
  const out: string[] = [];
  if (sub) out.push(sub);
  if (main) out.push(main);
  return out;
}
