"use server";
// 제안서 생성기(웹 제안서) 어드민 액션 — 생성/저장/발행/삭제 + 템플릿 저장 + AI 자동 생성.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { aiEnabled, aiText } from "@/lib/ai";
import { crawlUrl } from "@/lib/brand-crawl";
import { similarProductContent } from "@/lib/glovek-content";
import {
  saveProposal, deleteProposal, prefillFromBrand, saveTemplate, getProposalById,
  type ProposalInput, type TemplateInput, type ProposalFeature, type ProposalCreator,
} from "@/lib/proposal-doc";

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

export async function saveProposalDocAction(input: ProposalInput & { id: string }): Promise<{ ok: boolean; token?: string; error?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  try {
    const { token } = await saveProposal(input, u.name || u.id);
    revalidatePath("/proposal-docs");
    revalidatePath(`/proposal-docs/${input.id}`);
    return { ok: true, token };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "저장 실패" }; }
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
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };
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

  let parsed: {
    keywords?: string[]; subtitle?: string;
    product?: { name?: string; name_en?: string; volume?: string; features?: ProposalFeature[]; tags?: string[] };
  } | null = null;
  try {
    const text = await aiText({ system, user, maxTokens: 900 });
    parsed = text ? looseJson(text) : null;
  } catch (e) {
    return { ok: false, error: `AI 생성 실패: ${(e as Error).message}` };
  }
  if (!parsed) return { ok: false, error: "AI 응답 파싱 실패(JSON 형식 아님)." };

  // AI 가 keywords 를 배열이 아닌 형태로 반환해도 안전하게(문자열이면 단일 원소로).
  const kwRaw = Array.isArray(parsed.keywords) ? parsed.keywords : parsed.keywords ? [parsed.keywords] : [];
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

  const feats = Array.isArray(parsed.product?.features)
    ? parsed.product!.features.filter((f) => f && f.title).slice(0, 3)
    : [];
  const tags = Array.isArray(parsed.product?.tags)
    ? parsed.product!.tags.map((t) => String(t).replace(/^#/, "")).filter(Boolean).slice(0, 4)
    : [];

  const note =
    `${crawlNote} · glovek 유사 콘텐츠 ${glovek.length}건` +
    (glovek.length === 0 ? " (glovek 매칭 없음 — 콘텐츠 레퍼런스는 수동 입력 필요)" : "");

  return {
    ok: true,
    subtitle: parsed.subtitle || undefined,
    product_en: parsed.product?.name_en || undefined,
    product_volume: parsed.product?.volume || undefined,
    product_features: feats.length ? feats : undefined,
    product_tags: tags.length ? tags : undefined,
    featured: { name: parsed.product?.name || undefined, image_url: crawl.ok ? crawl.ogImage : undefined },
    creators: creators.length ? creators : undefined,
    note,
  };
}
