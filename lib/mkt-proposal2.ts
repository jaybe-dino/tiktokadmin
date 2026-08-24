// 마케팅 제안서 — 2번째 생성방식(설문 기반 자동생성). 기존(수동, mkt-proposal-doc.ts 의 prefillMktProposal)은 그대로 둔다.
//   브랜드의 마케팅 설문(surveys.kind='marketing_survey') 응답을 읽어 제목·제품·예산·국가를 자동으로 채운다.
//   생성 후에는 기존 에디터(/mkt-proposals/[id])에서 텍스트만 다듬으면 되도록, 여기서는 프리필까지만 담당한다.
import { query, queryOne } from "./db";
import { COUNTRY_LABEL_TO_CODE } from "./survey";
import type { MktCountry } from "./mkt-proposal-engine";
import type { MktProposalInput, MktProductItem, MktReferenceItem } from "./mkt-proposal-doc";

export interface SurveyEligibleBrand {
  brand_id: string;
  brand_name: string;
  responded_at: string;
  proposal_count: number; // 이미 생성된 방식2 제안서 수(재생성 시 참고)
}

/** 마케팅 설문(surveys.kind='marketing_survey') 응답이 있는 브랜드 목록(최신 응답순). */
export async function listSurveyEligibleBrands(): Promise<SurveyEligibleBrand[]> {
  const build = (genSourceCol: boolean) => `
    SELECT DISTINCT ON (b.id) b.id AS brand_id, b.brand_name, s.responded_at::text AS responded_at,
           COALESCE((SELECT count(*) FROM mkt_proposal_docs md WHERE md.brand_id=b.id${genSourceCol ? " AND md.gen_source='survey_auto'" : ""}),0)::int AS proposal_count
      FROM surveys s
      JOIN brands b ON b.id = s.brand_id
     WHERE s.kind='marketing_survey' AND s.responded_at IS NOT NULL
     ORDER BY b.id, s.responded_at DESC`;
  // 0087(gen_source) 미적용 DB 방어 — 컬럼 없으면 카운트 조건 없이 폴백(목록이 통째로 비지 않게).
  return query<SurveyEligibleBrand>(build(true)).catch(() => query<SurveyEligibleBrand>(build(false)).catch(() => []));
}

interface SurveyRow { answers: Record<string, string>; responded_at: string }

async function latestMarketingSurvey(brandId: string): Promise<SurveyRow | null> {
  return queryOne<SurveyRow>(
    `SELECT answers, responded_at::text AS responded_at FROM surveys
      WHERE brand_id=$1 AND kind='marketing_survey' AND responded_at IS NOT NULL
      ORDER BY responded_at DESC LIMIT 1`,
    [brandId],
  ).catch(() => null);
}

/** answers(설문 문항 텍스트가 키) 에서 라벨 키워드를 모두 포함하는 값을 찾는다(문항 번호·문구가 조금 달라도 매칭). */
function findAnswer(answers: Record<string, string>, ...keywords: string[]): string {
  for (const [k, v] of Object.entries(answers)) {
    if (!v?.trim()) continue;
    if (keywords.every((kw) => k.includes(kw))) return v;
  }
  return "";
}

/** 텍스트에서 http(s) URL 을 모두 추출(끝의 괄호·구두점 제거). */
function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
  return Array.from(new Set(matches.map((u) => u.replace(/[.,;:]+$/, "")))).slice(0, 5);
}

/** "500~1000만원"/"1000만원 이상"/"100만원~300만원" 등에서 최댓값을 원 단위로. 못 찾으면 null. */
export function parseBudgetWon(text: string): number | null {
  if (!text) return null;
  const nums: number[] = [];
  // "N억" (선택) + "M만원" 조합, 또는 "M만원" 단독.
  const re = /(?:(\d+(?:\.\d+)?)\s*억\s*)?(\d[\d,]*(?:\.\d+)?)\s*만\s*원?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const eok = m[1] ? parseFloat(m[1]) : 0;
    const man = parseFloat(m[2].replace(/,/g, ""));
    if (Number.isFinite(man)) nums.push(eok * 1_0000_0000 + man * 10_000);
  }
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

/** 텍스트에서 목표국 라벨을 찾아 MktCountry 코드로. 여러 개면 먼저 언급된 순서. 없으면 null. */
export function parseCountry(text: string): MktCountry | null {
  if (!text) return null;
  let best: { code: MktCountry; idx: number } | null = null;
  for (const [label, code] of Object.entries(COUNTRY_LABEL_TO_CODE)) {
    const idx = text.indexOf(label);
    if (idx >= 0 && (best === null || idx < best.idx)) best = { code: code as MktCountry, idx };
  }
  return best?.code ?? null;
}

// ── 제품 상세페이지 최소 스크레이핑(og 태그) — 사이트가 막으면 실패하고 넘어간다(강제 아님). ──
function metaTag(html: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i");
  const m = html.match(re) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? m[1] : "";
}
function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// 화장품 등 법정 표시·사용상 주의사항 상용구 — 실제 제품 특징(핵심요소)이 아니므로 걸러낸다.
//   상세페이지 og:description 에 이 문구가 그대로 들어있는 경우가 흔하다(제조사 공통 문구).
const CAUTION_MARKERS = [
  "사용 시 또는 사용", "직사광선", "부어오름", "가려움증", "전문의", "보관 및 취급",
  "어린이의 손", "상처가 있는", "화장품 사용", "이상 증상이나 부작용",
];
export function looksLikeCaution(text: string): boolean {
  const hits = CAUTION_MARKERS.filter((m) => text.includes(m)).length;
  return hits >= 2; // 두 개 이상 겹치면 법정 주의사항 문구로 판단(단순 우연한 단어 겹침과 구분)
}

export interface ScrapedProduct { name: string; image_url: string; description: string; ok: boolean }

/** 상품 상세페이지에서 og:title/og:image/og:description 최소 추출. 실패해도 throw 하지 않는다(ok=false). */
export async function scrapeProductPage(url: string): Promise<ScrapedProduct> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GlovekBot/1.0; +https://glovek.space)" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { name: "", image_url: "", description: "", ok: false };
    const html = await res.text();
    const titleM = html.match(/<title>([^<]*)<\/title>/i);
    const name = decodeEntities(metaTag(html, "og:title") || titleM?.[1] || "").trim();
    const image_url = decodeEntities(metaTag(html, "og:image")).trim();
    const description = decodeEntities(metaTag(html, "og:description") || metaTag(html, "description")).trim();
    return { name, image_url, description, ok: Boolean(name || image_url) };
  } catch {
    return { name: "", image_url: "", description: "", ok: false };
  }
}

// 카테고리 키워드 → 추천 강조색(제품 이미지 실측 추출은 아님 — 확인 후 조정 권장).
const ACCENT_BY_KEYWORD: [RegExp, string][] = [
  [/비타민|건강기능|영양제|이너뷰티/, "#16a34a"],
  [/스킨케어|코스메틱|화장품|뷰티|더마/, "#db2777"],
  [/헤어|샴푸/, "#7c3aed"],
  [/푸드|간식|식품/, "#ea580c"],
  [/패션|의류|악세서리/, "#1e3a8a"],
];
export function guessAccentColor(category: string | null | undefined): string {
  const c = category ?? "";
  for (const [re, hex] of ACCENT_BY_KEYWORD) if (re.test(c)) return hex;
  return "#111111";
}

/** 담당자가 외부 리서치 도구(탑뷰 등)에 붙여넣을 경쟁사·레퍼런스 리서치 프롬프트 — 실제 TikTok 조회는 자동화하지 않는다. */
export function buildReferencePrompt(productName: string, productUrl: string, countryLabel: string): string {
  return `역할: 뷰티 카테고리 마켓 리서처
대상 제품: ${productUrl}${productName ? ` + ${productName}` : ""}
목표 시장: ${countryLabel}
분석 기간: 최근 90일
다음 4개 소스를 수집해서 교차 검증해줘.
1. TikTok Shop — 동일/유사 SKU의 30·90일 GMV, 판매량, 성장률, 평균단가, 커미션율, 연결 크리에이터 수, 상위 영상 3개의 훅 카피
2. Amazon 리뷰 — 별점 분포, 1~2점 리뷰의 불만 유형, 4~5점 리뷰가 반복해서 칭찬하는 단어
3. YouTube 댓글 — 리뷰 영상 댓글에서 반복되는 질문과 의심
4. Shopee / 커머스 신호 — 동일 카테고리 가격대와 번들 구성

출력 형식:
[A] 고객 페인포인트 — 상위 5개. 각각 근거 인용 + 언급 빈도 + 어느 소스에서 나왔는지
[B] 효과적인 훅 포인트 — 상위 8개. 실제 영상/리뷰에 쓰인 표현 그대로 인용하고, 왜 먹혔는지 1줄 해석
[C] 경쟁사 격차 — 아무도 해결 못 한 페인포인트 / 아무도 안 쓴 훅 앵글
[D] 진입 기회 — 가격대, 포맷, 타겟 세그먼트 3가지 조합으로 제안

제약: 추정치는 '추정'이라고 표시. 데이터가 없는 항목은 없다고 명시. 없는 수치를 만들어내지 말 것.`;
}

export interface Mkt2GenResult {
  input: MktProposalInput;
  warnings: string[];
}

const COUNTRY_LABEL_KO: Record<MktCountry, string> = {
  US: "미국", TH: "태국", VN: "베트남", PH: "필리핀", MY: "말레이시아", SG: "싱가포르",
};

function currentKstMonth(): number {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.getUTCMonth() + 1;
}

/** 브랜드의 최신 마케팅 설문으로 마케팅 제안서(방식2) 입력을 자동 생성. */
export async function generateMktProposal2(brandId: string): Promise<Mkt2GenResult> {
  const warnings: string[] = [];
  const brand = await queryOne<{ brand_name: string; category: string | null }>(
    "SELECT brand_name, category FROM brands WHERE id=$1", [brandId],
  ).catch(() => null);
  if (!brand) throw new Error("브랜드를 찾을 수 없습니다.");

  const survey = await latestMarketingSurvey(brandId);
  if (!survey) throw new Error("마케팅 설문 응답이 없습니다 — tpartners 설문 이관 또는 수동 배정 후 다시 시도하세요.");
  const answers = survey.answers ?? {};

  // A2 대표 상품 링크 → URL 추출(최대 3개) + 각 페이지 최소 스크레이핑.
  // 문항번호(A2/D16/B8) 접두를 우선 매칭 — CSV 헤더가 실제로 "A2. 대표 상품 링크"식 표기라 가장 안정적.
  const a2 = findAnswer(answers, "A2") || findAnswer(answers, "대표", "상품", "링크");
  const a1 = findAnswer(answers, "A1") || findAnswer(answers, "핵심 효능");
  const urls = extractUrls(a2).slice(0, 3);
  if (urls.length === 0) warnings.push("설문에서 대표 상품 링크를 찾지 못했습니다 — 제품 정보를 직접 입력해주세요.");

  const scraped = await Promise.all(urls.map((u) => scrapeProductPage(u)));
  const products: MktProductItem[] = urls.map((u, i) => {
    const s = scraped[i];
    if (!s.ok) warnings.push(`상품 페이지 자동 인식 실패(${u}) — 이미지·정보를 직접 입력해주세요.`);
    // og:description 은 화장품 법정 표시·주의사항 같은 상용구가 그대로 딸려오는 경우가 많다
    // (진짜 핵심 특징이 아닌 임의 텍스트) — 그런 경우는 버리고, 설문의 실제 답변(A1 핵심 효능)만 신뢰한다.
    const desc = s.description?.trim() ?? "";
    const descUsable = desc.length > 0 && desc.length <= 120 && !looksLikeCaution(desc);
    if (desc && !descUsable) warnings.push(`상품 페이지 설명이 법정 주의사항 등 일반 문구로 보여 제외했습니다(${u}) — 핵심 특징을 직접 입력해주세요.`);
    const features = [i === 0 ? a1 : "", descUsable ? desc : ""].filter(Boolean);
    return { name: s.name || `제품 ${i + 1}`, image_url: s.image_url, features };
  });

  // D16 예산 — CSV 열 순서상 깔끔한 밴드형 문항이 서술형보다 먼저 오므로 D16 접두 매칭이 곧 우선순위가 된다.
  const budgetText = findAnswer(answers, "D16") || findAnswer(answers, "예산 규모") || findAnswer(answers, "예산");
  const monthlyBudget = parseBudgetWon(budgetText);
  if (monthlyBudget == null) warnings.push("설문에서 월 예산을 자동으로 읽지 못해 기본값(500만원)을 사용했습니다 — 확인해주세요.");

  // B8 진출 국가 — 텍스트에서 첫 언급 국가.
  const countryText = findAnswer(answers, "B8") || findAnswer(answers, "진출", "국가") || findAnswer(answers, "국가");
  const country = parseCountry(countryText);
  if (country == null) warnings.push("설문에서 목표 국가를 인식하지 못해 기본값(미국)을 사용했습니다 — 확인해주세요.");
  const countryCode: MktCountry = country ?? "US";

  // 레퍼런스 리서치 프롬프트 — intro_note(관리자 전용, 공개 미리보기에 노출 안 됨)에 정리.
  const countryLabel = COUNTRY_LABEL_KO[countryCode];
  const prompts = products.length
    ? products.map((p, i) => `[제품 ${i + 1}: ${p.name}]\n${buildReferencePrompt(p.name, urls[i] ?? "", countryLabel)}`).join("\n\n")
    : buildReferencePrompt("", "", countryLabel);
  const introNote =
    `[자동생성 메모 — 관리자 전용, 공개 제안서에는 표시되지 않습니다]\n` +
    `예산 인식: ${monthlyBudget != null ? `${Math.round(monthlyBudget / 10000).toLocaleString("ko-KR")}만원 (원문: "${budgetText.slice(0, 60)}")` : "인식 실패(기본값 사용)"}\n` +
    `국가 인식: ${country ? countryLabel : "인식 실패(기본값 사용)"} (원문: "${countryText.slice(0, 60)}")\n\n` +
    `[레퍼런스 리서치 프롬프트 — 외부 AI 리서치 도구에 붙여넣어 실행 후, 결과를 아래 '레퍼런스'에 직접 옮겨주세요]\n${prompts}`;

  // 레퍼런스는 제품별 빈 슬롯만 미리 만들어 둔다(리서치 결과를 직접 채워 넣도록).
  const references: MktReferenceItem[] = products.flatMap((p) =>
    Array.from({ length: 2 }, () => ({ product: p.name })),
  );

  const input: MktProposalInput = {
    brand_id: brandId,
    title: `${brand.brand_name} 마케팅 협업 제안서`,
    subtitle: "TikTok Shop GMV 성장 전략 제안",
    products_json: products,
    track: "standard",
    countries: [countryCode],
    start_month: currentKstMonth(),
    months: 6,
    monthly_budget: monthlyBudget ?? 5_000_000,
    operation_fee: 1_500_000,
    gmv_reserve_min: 1_000_000,
    gmv_reserve_max: 3_000_000,
    first_month_seeding: true,
    commission_pct: 10,
    references_json: references,
    intro_note: introNote,
    accent: guessAccentColor(brand.category),
    gen_source: "survey_auto",
  };
  return { input, warnings };
}
