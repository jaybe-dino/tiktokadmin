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

// 분류 라벨 → 검색 동의어(영문 포함) — glovek 크롤 데이터가 영문/혼용 표기여도 매칭되도록.
const SYNONYMS: Record<string, string[]> = {
  // 대분류
  "스킨케어": ["skincare", "skin care"],
  "메이크업": ["makeup", "cosmetic"],
  "헤어": ["hair"],
  "바디": ["body"],
  "향수·프래그런스": ["perfume", "fragrance"],
  "건강기능식품": ["supplement", "health"],
  "식품": ["food"],
  "생활·리빙": ["home", "living"],
  "패션·잡화": ["fashion"],
  "유아·키즈": ["baby", "kids"],
  "반려동물": ["pet"],
  "전자·기기": ["device", "electronics"],
  // 소분류
  "크림": ["cream", "moisturizer"],
  "세럼·앰플": ["serum", "ampoule", "essence"],
  "토너·스킨": ["toner"],
  "로션·에멀전": ["lotion", "emulsion"],
  "클렌저": ["cleanser", "cleansing"],
  "마스크팩": ["mask pack", "sheet mask", "mask"],
  "선케어": ["sunscreen", "sun care", "spf"],
  "미스트": ["mist"],
  "아이케어": ["eye cream"],
  "립": ["lip", "lipstick", "tint"],
  "베이스·쿠션": ["foundation", "cushion"],
  "아이": ["eyeshadow", "eyeliner", "mascara"],
  "치크": ["blush", "blusher"],
  "네일": ["nail"],
  "샴푸·트리트먼트": ["shampoo", "treatment", "conditioner"],
  "헤어에센스·오일": ["hair oil", "hair essence"],
  "염색·펌": ["hair dye", "hair color"],
  "두피케어": ["scalp"],
  "바디워시": ["body wash"],
  "바디로션·크림": ["body lotion", "body cream"],
  "핸드·풋": ["hand cream", "foot"],
  "데오드란트": ["deodorant"],
  "제모": ["hair removal", "wax"],
  "향수": ["perfume", "eau de"],
  "룸스프레이·디퓨저": ["diffuser", "room spray"],
  "비타민": ["vitamin"],
  "유산균": ["probiotics"],
  "콜라겐": ["collagen"],
  "오메가3": ["omega"],
  "다이어트": ["diet", "slimming"],
  "홍삼·인삼": ["ginseng", "red ginseng"],
  "스낵": ["snack"],
  "음료": ["drink", "beverage"],
  "간편식": ["instant", "meal"],
  "건강식품": ["health food"],
  "김·해조류": ["seaweed", "laver"],
  "주방": ["kitchen"],
  "세탁·청소": ["cleaning", "laundry"],
  "욕실": ["bath"],
  "수납·정리": ["storage", "organizer"],
  "의류": ["clothes", "apparel"],
  "가방": ["bag"],
  "액세서리": ["accessory", "jewelry"],
  "신발": ["shoes"],
  "기저귀·물티슈": ["diaper", "wipes"],
  "유아 스킨케어": ["baby lotion", "baby cream"],
  "완구": ["toy"],
  "유아식": ["baby food"],
  "사료·간식": ["pet food", "treats"],
  "위생·미용": ["grooming"],
  "용품": ["supplies"],
  "뷰티디바이스": ["beauty device", "led mask"],
  "생활가전": ["appliance"],
};

/** 라벨 하나 → 검색어 묶음: 라벨 원문 + "·" 분리 파트("세럼·앰플"→세럼/앰플) + 영문 동의어. */
function expandLabel(label: string): string[] {
  const parts = label.split("·").map((s) => s.trim()).filter((s) => s.length >= 2);
  const all = [label, ...parts, ...(SYNONYMS[label] ?? [])];
  return [...new Set(all)];
}

/** glovek 검색어 티어 — [소분류 묶음, 대분류 묶음] 순으로 시도(각 묶음은 OR 검색). */
export function categoryTermTiers(v: string | null | undefined): string[][] {
  const { main, sub } = splitCategory(v);
  const tiers: string[][] = [];
  if (sub) tiers.push(expandLabel(sub));
  if (main) tiers.push(expandLabel(main));
  return tiers;
}
