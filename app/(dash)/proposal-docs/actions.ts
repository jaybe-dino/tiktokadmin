"use server";
// 제안서 생성기(웹 제안서) 어드민 액션 — 생성/저장/발행/삭제 + 템플릿 저장 + AI 자동 생성.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { aiEnabled, aiText } from "@/lib/ai";
import { crawlUrl } from "@/lib/brand-crawl";
import { similarProductContent } from "@/lib/glovek-content";
import {
  saveProposal, deleteProposal, prefillFromBrand, saveTemplate, getProposalById,
  type ProposalInput, type TemplateInput, type ProposalFeature, type ProposalCreator,
} from "@/lib/proposal-doc";
import { OPS_TRACKS, OPS_COUNTRIES } from "@/lib/quote";

// 운영 견적(제안서 리스팅에서 만든 #2 견적)을 제안서 생성기 가격조건으로 불러오기용.
export interface OpsQuoteForDoc {
  id: string;
  created_at: string;
  status: string;
  trackLabel: string;
  mode: "commitment" | "monthly";
  months: number;
  monthly: number;      // 월 금액(약정이면 총액/개월)
  total: number;        // 계약 총액(약정=일시불 합계 / 매월=월액)
  discountNote: string;
  countries: string[];  // 한글 라벨
  featureLines: string[]; // 가격조건 기능 체크리스트에 넣을 제안견적 항목
}

/** 이 제안서(문서)의 브랜드가 가진 운영 견적 목록 — 최신순. 없으면 빈 배열. */
export async function listBrandOpsQuotesAction(docId: string): Promise<{ ok: boolean; error?: string; brandName?: string; quotes?: OpsQuoteForDoc[] }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  const doc = await queryOne<{ brand_id: string | null; brand_name: string | null }>(
    "SELECT brand_id, brand_name FROM proposal_docs WHERE id=$1", [docId],
  ).catch(() => null);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  if (!doc.brand_id) return { ok: true, brandName: doc.brand_name ?? undefined, quotes: [] };

  const rows = await query<{
    id: string; created_at: string; status: string; plan: string | null; term: string | null;
    quote_amount: number | null; amount: number | null; countries: string[] | null;
    contract_term: string | null; discount_note: string | null; period_start: string | null; period_end: string | null;
  }>(
    `SELECT id, created_at, status, plan, term, quote_amount, amount, countries, contract_term, discount_note, period_start, period_end
       FROM proposals
      WHERE brand_id=$1 AND COALESCE(kind,'sales')='sales' AND COALESCE(quote_amount, amount) IS NOT NULL
      ORDER BY created_at DESC LIMIT 30`,
    [doc.brand_id],
  ).catch(() => []);

  const quotes: OpsQuoteForDoc[] = rows.map((p) => {
    const track = OPS_TRACKS.find((t) => t.plan === p.plan);
    const mode: "commitment" | "monthly" = p.term === "commitment" ? "commitment" : "monthly";
    const mMatch = (p.contract_term ?? "").match(/약정\s*(\d+)\s*개월/);
    const months = mMatch ? Number(mMatch[1]) : 1;
    const total = Number(p.quote_amount ?? p.amount ?? 0);
    const monthly = mode === "commitment" && months > 0 ? Math.round(total / months) : total;
    const countryLabels = (p.countries ?? []).map((c) => OPS_COUNTRIES.find((x) => x.code === c)?.label ?? c);
    const won = (n: number) => n.toLocaleString("ko-KR") + "원";
    const featureLines = [
      `트랙: ${track?.label ?? p.plan ?? "운영"}`,
      countryLabels.length ? `대상 국가: ${countryLabels.join("·")}` : "",
      mode === "commitment" ? `약정 ${months}개월 · 월 ${won(monthly)}(일시불 ${won(total)})` : `월 정기결제 ${won(monthly)}`,
      p.discount_note ? `견적: ${p.discount_note}` : "",
    ].filter(Boolean);
    return {
      id: p.id, created_at: p.created_at, status: p.status,
      trackLabel: track?.label ?? (p.plan ?? "운영"), mode, months, monthly, total,
      discountNote: p.discount_note ?? "", countries: countryLabels, featureLines,
    };
  });

  return { ok: true, brandName: doc.brand_name ?? undefined, quotes };
}

export async function createProposalDocAction(brandId: string | null): Promise<{ ok: boolean; id?: string; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  try {
    const prefill: ProposalInput = brandId ? await prefillFromBrand(brandId) : {};
    const { id } = await saveProposal(prefill, u.name || u.id);
    revalidatePath("/proposal-docs");
    return { ok: true, id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "생성 실패" }; }
}

export async function saveProposalDocAction(input: ProposalInput & { id: string }): Promise<{ ok: boolean; token?: string; error?: string; routineAdded?: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  try {
    const { token } = await saveProposal(input, u.name || u.id);
    // 6) 무가시딩/라이브 수량이 0이 아니면 마케팅 루틴 운영대행(시딩·라이브) 카드 자동 생성/갱신.
    const routineAdded = await ensureRoutineMktCard(input.id).catch(() => false);
    revalidatePath("/proposal-docs");
    revalidatePath(`/proposal-docs/${input.id}`);
    if (routineAdded) revalidatePath("/mkt");
    return { ok: true, token, routineAdded };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "저장 실패" }; }
}

/** 운영 제안서의 무가시딩/라이브 수량이 0이 아니면, 해당 브랜드의 루틴 운영대행 카드(kind='routine')를
 *  마케팅 프로젝트에 생성(없으면)하거나 노트를 갱신한다. 반환: 신규 생성 여부. */
async function ensureRoutineMktCard(docId: string): Promise<boolean> {
  const doc = await getProposalById(docId).catch(() => null);
  if (!doc || !doc.brand_id) return false;
  const seeding = Number(doc.seeding_qty ?? 0) || 0;
  const live = Number(doc.live_qty ?? 0) || 0;
  if (seeding === 0 && live === 0) return false;
  const note = `무가시딩 ${seeding} · 라이브 ${live} (운영 제안서 반영)`;
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM mkt_projects WHERE brand_id=$1 AND kind='routine' LIMIT 1", [doc.brand_id],
  ).catch(() => null);
  if (existing) {
    await query("UPDATE mkt_projects SET note=$2, updated_at=now() WHERE id=$1", [existing.id, note]).catch(() => {});
    return false;
  }
  await query(
    `INSERT INTO mkt_projects (brand_id, kind, title, note, proposal_status)
     VALUES ($1,'routine',$2,$3,'draft')`,
    [doc.brand_id, "루틴 운영대행 (시딩·라이브)", note],
  ).catch(() => {});
  return true;
}

export async function deleteProposalDocAction(id: string): Promise<{ ok: boolean }> {
  const u = await currentUser();
  if (!u) return { ok: false };
  await deleteProposal(id).catch(() => {});
  revalidatePath("/proposal-docs");
  return { ok: true };
}

export async function saveTemplateAction(input: TemplateInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  try {
    const { id } = await saveTemplate(input, u.name || u.id);
    revalidatePath("/proposal-docs/templates");
    return { ok: true, id };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "저장 실패" }; }
}

// ─────────────────────────────────────────────────────────────
// AI 제안서 기본내용 자동 생성.
//   브랜드 제출 URL 을 크롤 → AI 가 핵심 SKU 소개/부제/검색 키워드를 추출하고,
//   그 키워드로 glovek.space 에서 유사 제품 콘텐츠를 찾아 "콘텐츠 레퍼런스" 초안을 만든다.
//   저장하지 않고 draft 만 반환 → 에디터가 필드에 채우고 담당자가 편집 후 저장.
//   허위 수치는 만들지 않는다(매출/ROAS 등 지표는 glovek 실데이터가 있을 때만 채움).
// ─────────────────────────────────────────────────────────────
export interface GenerateContentResult {
  ok: boolean;
  error?: string;
  subtitle?: string;
  product_en?: string;
  product_volume?: string;
  product_features?: ProposalFeature[];
  product_tags?: string[];
  featured?: { name?: string; image_url?: string };
  creators?: ProposalCreator[];
  note?: string;
}

// 관대한 JSON 추출(코드펜스·앞뒤 텍스트 허용).
function looseJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { /* fallthrough */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as T; } catch { /* noop */ } }
  return null;
}

const firstUrl = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") return /^https?:\/\//i.test(v) ? v : "";
  if (typeof v === "object") { for (const x of Object.values(v as Record<string, unknown>)) { const u = firstUrl(x); if (u) return u; } }
  return "";
};

export async function generateProposalContentAction(proposalId: string): Promise<GenerateContentResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  // AI 키가 없어도 크롤·glovek 레퍼런스 채움은 동작하도록 하드 차단하지 않음(BUG-10).
  const doc = await getProposalById(proposalId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  if (!doc.brand_id) return { ok: false, error: "브랜드가 연결되지 않은 제안서입니다." };

  // 브랜드 URL·카테고리 수집(brands + brand_company).
  const b = await queryOne<{
    brand_name: string; brand_url: string | null; category: string | null;
    sales_channel_url: string | null; product_category: string | null; channel_urls: unknown;
  }>(
    `SELECT b.brand_name, b.brand_url, b.category,
            c.sales_channel_url, c.product_category, c.channel_urls
       FROM brands b LEFT JOIN brand_company c ON c.brand_id = b.id
      WHERE b.id = $1`,
    [doc.brand_id],
  ).catch(() => null);
  if (!b) return { ok: false, error: "브랜드 정보를 찾을 수 없습니다." };

  const url = (b.brand_url || "").trim() || (b.sales_channel_url || "").trim() || firstUrl(b.channel_urls);
  const category = (b.category || b.product_category || "").trim();
  if (!url && !category) return { ok: false, error: "브랜드 URL·카테고리가 모두 비어 있어 참고할 정보가 없습니다. (회사정보에서 판매채널 URL을 입력하세요)" };

  // 1) URL 크롤(있으면).
  const crawl = url ? await crawlUrl(url) : { ok: false as const, error: "URL 없음" };
  const crawlNote = url ? (crawl.ok ? `크롤 성공(${url})` : `크롤 실패(${crawl.error})`) : "URL 미등록";

  // 2) AI 로 핵심 SKU 소개·부제·검색 키워드 추출(JSON).
  const system =
    "너는 글로벌 커머스 대행사 GloveK 의 B2B 세일즈 카피라이터다. 크롤한 브랜드 페이지 정보로 틱톡샵 제안서의 기본 내용을 만든다. " +
    "반드시 유효한 JSON 하나만 출력한다(코드펜스·설명 금지). 사실 기반으로 담백하게 쓰고, 매출·ROAS 같은 성과 수치는 절대 지어내지 마라. " +
    "개인정보(담당자명·연락처·사업자번호)는 언급하지 마라.";
  const user =
    `브랜드명: ${b.brand_name}\n카테고리: ${category || "미상"}\nURL: ${url || "없음"}\n` +
    `페이지 제목: ${crawl.ok ? crawl.title ?? "" : ""}\n페이지 설명/본문: ${crawl.ok ? (crawl.text ?? "").slice(0, 3000) : "(크롤 실패 — 브랜드명·카테고리만으로 추정)"}\n\n` +
    `아래 JSON 스키마로만 출력:\n` +
    `{"keywords":["glovek 유사 콘텐츠 검색용 카테고리/제품 키워드 2~5개(한글 위주, 영문 병기 가능)"],` +
    `"subtitle":"표지 부제 한 줄",` +
    `"product":{"name":"핵심 제품명(한글)","name_en":"영문명(모르면 \\"\\")","volume":"용량/규격(모르면 \\"\\")",` +
    `"features":[{"title":"특징 제목","desc":"1문장 설명"}],"tags":["해시태그(# 제외)"]}}`;

  type Parsed = {
    keywords?: string[]; subtitle?: string;
    product?: { name?: string; name_en?: string; volume?: string; features?: ProposalFeature[]; tags?: string[] };
  };
  let parsed: Parsed | null = null;
  let aiNote = "";
  if (aiEnabled()) {
    try {
      const text = await aiText({ system, user, maxTokens: 900 });
      parsed = text ? looseJson(text) : null;
      if (!parsed) aiNote = "AI 응답 파싱 실패 — 크롤·레퍼런스만 반영";
    } catch (e) {
      aiNote = `AI 생성 실패(${(e as Error).message}) — 크롤·레퍼런스만 반영`;
      parsed = null;
    }
  } else {
    aiNote = "AI 키 미설정 — 크롤·레퍼런스만 반영";
  }
  const P: Parsed = parsed ?? {};

  // AI 가 keywords 를 배열이 아닌 형태로 반환해도 안전하게(문자열이면 단일 원소로).
  const kwRaw = Array.isArray(P.keywords) ? P.keywords : P.keywords ? [P.keywords] : [];
  const keywords = kwRaw.map((k) => String(k)).filter(Boolean);
  if (category) keywords.push(category);

  // 3) glovek 유사 제품 콘텐츠 → 콘텐츠 레퍼런스(크리에이터) 초안.
  const glovek = await similarProductContent(keywords, 8).catch(() => []);
  const creators: ProposalCreator[] = glovek
    .filter((g) => g.handle || g.name || g.image_url)
    .map((g) => ({
      handle: g.handle || "",
      brand: g.brand,
      product: g.name,
      thumb_url: g.image_url,
      caption: g.name || g.category,
      // 매출·ROAS·수수료율·참여율 등 성과 지표는 단위/통화를 확신할 수 없어 자동 채우지 않음(담당자 입력).
    }));

  const feats = Array.isArray(P.product?.features)
    ? P.product!.features.filter((f) => f && f.title).slice(0, 3)
    : [];
  const tags = Array.isArray(P.product?.tags)
    ? P.product!.tags.map((t) => String(t).replace(/^#/, "")).filter(Boolean).slice(0, 4)
    : [];

  const note =
    (aiNote ? `${aiNote} · ` : "") +
    `${crawlNote} · glovek 유사 콘텐츠 ${glovek.length}건` +
    (glovek.length === 0 ? " (glovek 매칭 없음 — 콘텐츠 레퍼런스는 수동 입력 필요)" : "");

  return {
    ok: true,
    subtitle: P.subtitle || undefined,
    product_en: P.product?.name_en || undefined,
    product_volume: P.product?.volume || undefined,
    product_features: feats.length ? feats : undefined,
    product_tags: tags.length ? tags : undefined,
    featured: { name: P.product?.name || undefined, image_url: crawl.ok ? crawl.ogImage : undefined },
    creators: creators.length ? creators : undefined,
    note,
  };
}

// ─────────────────────────────────────────────────────────────
// 상품 정보 → USP 자동 추출. 핵심 SKU 제품명·설명(+추가 입력)만으로 특징 카드(USP)·태그·영문명·용량 생성.
//   URL 크롤 없이도 동작 — 담당자가 상품 정보를 넣으면 적절한 USP 를 뽑는다. 허위 수치 금지.
// ─────────────────────────────────────────────────────────────
export interface UspResult {
  ok: boolean; error?: string;
  product_en?: string; product_volume?: string;
  product_features?: ProposalFeature[]; product_tags?: string[];
}
export async function generateProductUspAction(proposalId: string, productInfo?: string): Promise<UspResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };
  const doc = await getProposalById(proposalId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  const p0 = doc.products[0];
  const ctx = [
    p0?.name ? `제품명: ${p0.name}` : "",
    doc.product_en ? `영문명: ${doc.product_en}` : "",
    doc.product_volume ? `용량/규격: ${doc.product_volume}` : "",
    p0?.desc ? `분류/설명: ${p0.desc}` : "",
    (productInfo ?? "").trim() ? `추가 상품 정보:\n${(productInfo ?? "").trim()}` : "",
  ].filter(Boolean).join("\n");
  if (!ctx) return { ok: false, error: "제품 정보를 입력하세요(핵심 SKU 제품명·설명 또는 아래 상품정보 칸)." };

  const system =
    "너는 글로벌 커머스 대행사 GloveK 의 B2B 세일즈 카피라이터다. 주어진 상품 정보에서 소비자에게 통하는 " +
    "USP(핵심 차별점)를 뽑아 제안서 특징 카드를 만든다. 반드시 유효한 JSON 하나만 출력(코드펜스·설명 금지). " +
    "상품 정보에 근거해 담백하게 쓰고, 임상 수치·효능 보장 등 근거 없는 과장은 금지. 개인정보는 담지 마라.";
  const user =
    `아래 상품 정보로 USP 특징 카드 3개·해시태그 3~4개(+가능하면 영문명·용량)를 만들어줘.\n\n${ctx.slice(0, 4000)}\n\n` +
    `JSON 스키마: {"name_en":"영문명(모르면 \\"\\")","volume":"용량(모르면 \\"\\")",` +
    `"features":[{"title":"USP 제목(짧게)","desc":"1문장 설명"}],"tags":["해시태그(# 제외)"]}`;

  let parsed: { name_en?: string; volume?: string; features?: ProposalFeature[]; tags?: string[] } | null = null;
  try {
    const text = await aiText({ system, user, maxTokens: 800 });
    parsed = text ? looseJson(text) : null;
  } catch (e) {
    return { ok: false, error: `USP 생성 실패: ${(e as Error).message}` };
  }
  if (!parsed) return { ok: false, error: "AI 응답 파싱 실패." };
  const feats = Array.isArray(parsed.features) ? parsed.features.filter((f) => f && f.title).slice(0, 3) : [];
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).replace(/^#/, "")).filter(Boolean).slice(0, 4) : [];
  if (feats.length === 0 && tags.length === 0) return { ok: false, error: "추출된 USP 가 없습니다 — 상품 정보를 더 구체적으로 입력하세요." };
  return {
    ok: true,
    product_en: parsed.name_en || undefined,
    product_volume: parsed.volume || undefined,
    product_features: feats.length ? feats : undefined,
    product_tags: tags.length ? tags : undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// 제품 카테고리 → glovek 유사 제품 콘텐츠(썸네일)로 콘텐츠 레퍼런스 자동 채움.
//   카테고리 입력(없으면 브랜드 카테고리) → glovek 매칭 → 크리에이터 카드(썸네일 포함) 반환.
// ─────────────────────────────────────────────────────────────
export async function fillReferencesByCategoryAction(proposalId: string, category?: string): Promise<{ ok: boolean; error?: string; creators?: ProposalCreator[]; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getProposalById(proposalId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  let cat = (category ?? "").trim();
  if (!cat && doc.brand_id) {
    const b = await queryOne<{ category: string | null; product_category: string | null }>(
      `SELECT b.category, c.product_category FROM brands b LEFT JOIN brand_company c ON c.brand_id=b.id WHERE b.id=$1`,
      [doc.brand_id],
    ).catch(() => null);
    cat = (b?.category || b?.product_category || "").trim();
  }
  if (!cat) return { ok: false, error: "카테고리를 입력하세요(또는 브랜드에 카테고리를 먼저 설정)." };

  const glovek = await similarProductContent([cat], 8).catch(() => []);
  const creators: ProposalCreator[] = glovek
    .filter((g) => g.handle || g.name || g.image_url)
    .map((g) => ({
      handle: g.handle || "",
      brand: g.brand,
      product: g.name,
      thumb_url: g.image_url, // glovek 썸네일
      caption: g.name || g.category,
      // 매출·ROAS 등 지표는 자동 채우지 않음(허위 방지).
    }));
  const note = `카테고리 '${cat}' · glovek 유사 콘텐츠 ${glovek.length}건` +
    (glovek.length === 0 ? " — 매칭 없음(수동 입력 필요)" : " 불러옴");
  return { ok: true, creators: creators.length ? creators : undefined, note };
}
