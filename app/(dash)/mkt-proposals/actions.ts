"use server";
// 마케팅 제안서 문서 액션 — 생성·저장·삭제·상태·파이프라인 연동.
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { friendlyError } from "@/lib/action";
import {
  saveMktProposal, deleteMktProposal, prefillMktProposal, getMktProposalById,
  saveMktTemplate, getMktTemplate, deleteMktTemplate,
  type MktProposalInput, type MktTemplateConfig, type MktReferenceItem,
} from "@/lib/mkt-proposal-doc";
import { similarContentRefs, glovekZeroDiagnosis, listGlovekCategories, glovekDataProfile } from "@/lib/glovek-content";
import { categoryTermTiers } from "@/lib/categories";

type R = { ok: boolean; error?: string };

export async function createMktProposalDocAction(brandId: string, category?: string): Promise<R & { id?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!brandId) return { ok: false, error: "브랜드를 선택하세요." };
  try {
    const prefill = await prefillMktProposal(brandId);
    if (category?.trim()) prefill.category = category.trim();
    const { id } = await saveMktProposal(prefill, u.name || u.id);
    revalidatePath("/mkt-proposals");
    return { ok: true, id };
  } catch (e) { return { ok: false, error: friendlyError(e, "마케팅 제안서") }; }
}

export async function saveMktProposalDocAction(input: MktProposalInput): Promise<R & { token?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.title?.trim()) return { ok: false, error: "제목을 입력하세요." };
  try {
    const { token } = await saveMktProposal(input, u.name || u.id);
    revalidatePath("/mkt-proposals");
    if (input.id) revalidatePath(`/mkt-proposals/${input.id}`);
    if (input.brand_id) revalidatePath(`/brand/${input.brand_id}`);
    return { ok: true, token };
  } catch (e) { return { ok: false, error: friendlyError(e, "마케팅 제안서") }; }
}

// ── 템플릿: 저장 / 불러오기 / 삭제 ──
export async function saveMktTemplateAction(name: string, config: MktTemplateConfig): Promise<R & { id?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!name?.trim()) return { ok: false, error: "템플릿 이름을 입력하세요." };
  try { const { id } = await saveMktTemplate(name, config, u.name || u.id); revalidatePath("/mkt-proposals"); return { ok: true, id }; }
  catch (e) { return { ok: false, error: friendlyError(e, "마케팅 제안서") }; }
}
export async function loadMktTemplateAction(id: string): Promise<R & { config?: MktTemplateConfig; name?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const t = await getMktTemplate(id);
  if (!t) return { ok: false, error: "템플릿을 찾을 수 없습니다." };
  return { ok: true, config: t.config, name: t.name };
}
export async function deleteMktTemplateAction(id: string): Promise<R> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  try { await deleteMktTemplate(id); revalidatePath("/mkt-proposals"); return { ok: true }; }
  catch (e) { return { ok: false, error: friendlyError(e, "마케팅 제안서") }; }
}

export async function deleteMktProposalDocAction(id: string): Promise<R> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  try { await deleteMktProposal(id); revalidatePath("/mkt-proposals"); return { ok: true }; }
  catch (e) { return { ok: false, error: friendlyError(e, "마케팅 제안서") }; }
}

/** glovek DB 의 실제 카테고리 값 목록 — 에디터에서 "실값 그대로 선택"용(마케팅·운영 제안서 공용). */
export async function listGlovekCategoriesAction(): Promise<R & { categories?: { value: string; count: number }[] }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const categories = await listGlovekCategories(60).catch(() => []);
  if (categories.length === 0) {
    // glovek 스키마에 카테고리 컬럼 자체가 없으면(현재 실스키마) 그 사실을 정확히 안내.
    const profile = await glovekDataProfile().catch(() => null);
    if (profile?.configured && profile.tables.some((t) => t.exists) && profile.tables.every((t) => !t.fields.category)) {
      return { ok: false, error: "glovek DB에 카테고리 컬럼이 없습니다 — 실값 선택 대신 제품명·영문 키워드 자동 검색이 사용됩니다(그냥 '불러오기'를 누르세요)." };
    }
    return { ok: false, error: `glovek 카테고리를 불러오지 못했습니다 — ${await glovekZeroDiagnosis()}` };
  }
  return { ok: true, categories };
}

// ── glovek 유사 콘텐츠 레퍼런스 불러오기 ──
//   목적: 마케팅·운영대행 제안 시점엔 설문(제품정보)/상품링크/카테고리 중 뭐든 있으니, 있는 것부터
//   차례로 검색해 glovek.space 처럼 썸네일 레퍼런스를 자동으로 띄운다. glovek DB(읽기전용) 직접
//   조회 — 별도 API 불필요. 소스 우선순위(첫 매칭에서 종료):
//     ① 선택·저장된 카테고리(실값 선택 포함, 소분류→대분류 티어)
//     ② 설문·상품링크 유래 제품명(products_json, 미저장분은 에디터가 전달)
//     ③ 브랜드 카테고리
//   썸네일은 glovek 이 웹에 띄우는 이미지 URL 그대로 — 공개 페이지에선 웹썸네일 프록시로 표시·영구 캐시.
export async function fillGlovekMktRefsAction(
  docId: string, category?: string, productNames?: string[],
): Promise<R & { refs?: MktReferenceItem[]; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };

  const sources: { label: string; tiers: string[][] }[] = [];
  const cat = (category ?? "").trim() || (doc.category ?? "").trim();
  if (cat) {
    const tiers = categoryTermTiers(cat);
    sources.push({ label: `카테고리 「${cat}」`, tiers: tiers.length ? tiers : [[cat]] });
  }
  const names = (productNames?.length ? productNames : (doc.products_json ?? []).flatMap((p) => [p.name_en, p.name]))
    .map((s) => (s ?? "").trim()).filter(Boolean);
  if (names.length) sources.push({ label: `제품명(설문·상품링크) 「${names.slice(0, 2).join(", ")}」`, tiers: [names.slice(0, 6)] });
  if (doc.brand_id) {
    const b = await queryOne<{ category: string | null; product_category: string | null }>(
      "SELECT b.category, c.product_category FROM brands b LEFT JOIN brand_company c ON c.brand_id=b.id WHERE b.id=$1",
      [doc.brand_id],
    ).catch(() => null);
    const bc = (b?.category || b?.product_category || "").trim();
    if (bc && bc !== cat) {
      const tiers = categoryTermTiers(bc);
      sources.push({ label: `브랜드 카테고리 「${bc}」`, tiers: tiers.length ? tiers : [[bc]] });
    }
  }
  if (sources.length === 0) return { ok: false, error: "검색 기준이 없습니다 — 설문/제품을 먼저 넣거나 카테고리를 선택하세요." };

  let usedLabel = sources[0].label;
  let used: string[] = [];
  let glovek: Awaited<ReturnType<typeof similarContentRefs>> = [];
  outer: for (const src of sources) {
    for (const tier of src.tiers) {
      usedLabel = src.label; used = tier;
      glovek = await similarContentRefs(tier, 8).catch(() => []);
      if (glovek.length > 0) break outer;
    }
  }
  const refs: MktReferenceItem[] = glovek
    .filter((g) => g.handle || g.name || g.image_url)
    .map((g) => ({
      creator: g.handle || undefined,
      product: g.name || undefined,
      gmv: g.gmv || undefined,
      // 지표 묶음 — 조회수·좋아요·댓글·공유(있는 것만).
      engagement: [
        g.views ? `조회수 ${g.views}` : "", g.likes ? `♥ ${g.likes}` : "",
        g.comments ? `댓글 ${g.comments}` : "", g.shares ? `공유 ${g.shares}` : "",
      ].filter(Boolean).join(" · ") || undefined,
      desc: [g.brand, g.category].filter(Boolean).join(" · ").slice(0, 120) || undefined,
      image_url: g.image_url || undefined,
      url: g.link || undefined, // 썸네일 클릭 → 틱톡 이동
      // ROAS·수수료 등 성과 지표는 자동 채우지 않음(허위 방지 — 담당자 입력).
    }));
  // 썸네일 영구 저장(핀) — 외부 CDN 만료·차단과 무관하게 항상 뜨도록 내부 URL 로 치환(실패 시 원본 유지).
  if (doc.brand_id && refs.length > 0) {
    const { pinExternalImage } = await import("@/lib/ref-pin");
    await Promise.all(refs.map(async (r) => {
      const pinned = await pinExternalImage(doc.brand_id!, r.image_url, r.url);
      if (pinned) r.image_url = pinned;
    }));
  }
  let note = `${usedLabel}(검색어: ${used.slice(0, 4).join(", ")}${used.length > 4 ? " 외" : ""}) · glovek 유사 콘텐츠 ${refs.length}건`;
  if (refs.length === 0) note += ` — ${await glovekZeroDiagnosis()}`;
  return { ok: true, refs: refs.length ? refs : undefined, note };
}

// ── 이미지 영구저장(복구) — 저장된 문서의 외부 이미지(제품·레퍼런스 썸네일)를 서버가 내려받아
//    DB 에 보관하고 내부 URL 로 치환(만료 시 oEmbed 재조회 포함). 이미지 2개 컬럼만 직접 UPDATE.
export async function pinMktProposalImagesAction(docId: string): Promise<R & {
  fixed?: number; healed?: number; ok_count?: number; dead?: string[];
  products_json?: import("@/lib/mkt-proposal-doc").MktProductItem[]; references_json?: MktReferenceItem[];
}> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  if (!doc.brand_id) return { ok: false, error: "브랜드가 연결되지 않은 제안서입니다 — 브랜드 연결 후 실행하세요." };
  const { pinExternalImage, verifyInternalImage } = await import("@/lib/ref-pin");
  const { tiktokPageUrl } = await import("@/lib/image-fetch");
  const ext = (v?: string | null) => Boolean(v && /^https?:\/\//i.test(v));
  const dead: string[] = [];
  let fixed = 0, healed = 0, okCnt = 0;

  // 외부 URL 은 내려받아 저장, 내부 경로는 공개 프록시 서빙 조건(존재·브랜드 일치·image/*)을
  // 검증하고 어긋나면 복구(운영 제안서 pinProposalImagesAction 과 동일 로직).
  // 썸네일 칸에 틱톡 "영상 링크" 가 들어온 수기 입력은 링크 칸으로 옮기고 실제 썸네일을 재조회한다.
  const handle = async (
    label: string, url: string | null | undefined, link: string | null | undefined,
    setUrl: (u: string) => void, setLink?: (u: string) => void,
  ) => {
    const page = tiktokPageUrl(url);
    if (page && !(link ?? "").trim() && setLink) { link = page; setLink(page); }
    if (!(url ?? "").trim() && ext(link)) {
      // 썸네일이 비어 있어도 영상 링크가 있으면 현재 유효한 썸네일을 받아 채운다.
      const pinned = await pinExternalImage(doc.brand_id!, link, link);
      if (pinned) { setUrl(pinned); fixed++; } else dead.push(`${label} — 썸네일 재조회 실패`);
      return;
    }
    if (ext(url)) {
      const pinned = await pinExternalImage(doc.brand_id!, url, link);
      if (pinned) { setUrl(pinned); fixed++; } else dead.push(label);
      return;
    }
    const chk = await verifyInternalImage(doc.brand_id!, url, link);
    if (chk.status === "ok") okCnt++;
    else if (chk.status === "healed") { setUrl(chk.url); healed++; }
    else if (chk.status === "dead") dead.push(`${label} — ${chk.reason}`);
  };

  const refs = (doc.references_json ?? []).map((r) => ({ ...r }));
  await Promise.all(refs.map((r) =>
    handle(`레퍼런스 ${r.creator || r.product || "?"}`, r.image_url, r.url,
      (v) => { r.image_url = v; }, (v) => { r.url = v; })));
  const products = (doc.products_json ?? []).map((p) => ({ ...p }));
  await Promise.all(products.map((p) =>
    handle(`제품 ${p.name}`, p.image_url, null, (v) => { p.image_url = v; })));

  await query(
    `UPDATE mkt_proposal_docs SET products_json=$2::jsonb, references_json=$3::jsonb, updated_at=now() WHERE id=$1`,
    [docId, JSON.stringify(products), JSON.stringify(refs)],
  );
  revalidatePath(`/mkt-proposals/${docId}`);
  return { ok: true, fixed, healed, ok_count: okCnt, dead, products_json: products, references_json: refs };
}

// 상태 매핑: 제안서 문서 status → 파이프라인 mkt_projects.proposal_status
const PROJ_STATUS: Record<string, string> = { draft: "draft", sent: "sent", accepted: "won", rejected: "dropped" };

// ── 제품 유형별 레퍼런스 가져오기 ─────────────────────────────
//   glovek 자동 검색으로 맞는 콘텐츠가 안 나와 담당자가 직접 찾아 넣는 경우가 많다.
//   그렇게 쌓인 레퍼런스를 "제품 유형"(샴푸 등) 기준으로 다시 꺼내 쓴다 — 예: 볼벳(샴푸)에
//   넣었던 레퍼런스를 산모희(임산부 샴푸) 제안서에서 그대로 재사용.
//   검색 범위: 마케팅 제안서 references_json + 운영 제안서 creators(브랜드 무관, 전체 제안서).
export async function importRefsByProductTypeAction(docId: string, keyword: string): Promise<R & {
  refs?: MktReferenceItem[]; note?: string;
}> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const kw = (keyword ?? "").trim();
  if (kw.length < 2) return { ok: false, error: "제품 유형을 2글자 이상 입력하세요(예: 샴푸)." };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  const like = `%${kw}%`;

  // 마케팅 제안서 — 카테고리·제품명·레퍼런스 텍스트 어디에든 유형이 걸리면 후보.
  const mkt = await query<{ title: string; references_json: unknown }>(
    `SELECT d.title, d.references_json FROM mkt_proposal_docs d
      WHERE d.id <> $1
        AND (COALESCE(d.category,'') ILIKE $2 OR d.products_json::text ILIKE $2 OR d.references_json::text ILIKE $2)
      ORDER BY d.updated_at DESC LIMIT 20`,
    [docId, like],
  ).catch(() => []);
  // 운영 제안서 — 크리에이터 레퍼런스(제품·브랜드명에 유형이 들어간 경우).
  const ops = await query<{ title: string; creators: unknown }>(
    `SELECT title, creators FROM proposal_docs
      WHERE (products::text ILIKE $1 OR creators::text ILIKE $1)
      ORDER BY updated_at DESC LIMIT 20`,
    [like],
  ).catch(() => []);

  const keyOf = (url?: unknown, creator?: unknown) =>
    (String(url ?? "").trim() || String(creator ?? "").trim().replace(/^@+/, "")).toLowerCase();
  const have = new Set((doc.references_json ?? []).map((r) => keyOf(r.url, r.creator)).filter(Boolean));
  const hit = (r: Record<string, unknown>) =>
    [r.product, r.desc, r.creator, r.brand].some((v) => String(v ?? "").toLowerCase().includes(kw.toLowerCase()));

  const out: MktReferenceItem[] = [];
  const push = (r: MktReferenceItem) => {
    const k = keyOf(r.url, r.creator);
    if (!k || have.has(k)) return;
    have.add(k); out.push(r);
  };
  for (const d of mkt) {
    const arr = Array.isArray(d.references_json) ? (d.references_json as Record<string, unknown>[]) : [];
    // 문서 전체가 그 유형이면 전부, 아니면 항목 단위로 유형이 걸린 것만.
    const all = arr.filter(hit).length === 0;
    for (const r of arr) {
      if (!all && !hit(r)) continue;
      push({
        creator: String(r.creator ?? "") || undefined, product: String(r.product ?? "") || undefined,
        gmv: String(r.gmv ?? "") || undefined, roas: String(r.roas ?? "") || undefined,
        engagement: String(r.engagement ?? "") || undefined, desc: String(r.desc ?? "") || undefined,
        image_url: String(r.image_url ?? "") || undefined, url: String(r.url ?? "") || undefined,
      });
    }
  }
  for (const d of ops) {
    const arr = Array.isArray(d.creators) ? (d.creators as Record<string, unknown>[]) : [];
    for (const c of arr) {
      if (!hit({ product: c.product, desc: c.caption, creator: c.handle, brand: c.brand })) continue;
      push({
        creator: String(c.handle ?? "") || undefined, product: String(c.product ?? c.brand ?? "") || undefined,
        gmv: String(c.revenue ?? "") || undefined, roas: String(c.roas ?? "") || undefined,
        engagement: String(c.engagement ?? "") || undefined,
        image_url: String(c.thumb_url ?? "") || undefined, url: String(c.link ?? "") || undefined,
      });
    }
  }
  if (out.length === 0) {
    return { ok: false, error: `「${kw}」 유형으로 기존 제안서에서 찾은 레퍼런스가 없습니다 — 다른 표현(예: 헤어/두피)으로 시도해보세요.` };
  }
  return { ok: true, refs: out.slice(0, 12), note: `「${kw}」 유형 레퍼런스 ${Math.min(out.length, 12)}건 — 확인 후 [저장]을 눌러 반영하세요.` };
}

// ── 사전 설문 → 핵심 SKU USP 자동 채움 ────────────────────────
//   마케팅 제안서는 운영대행 계약 "전"에 나가는 경우가 많아, 계약 후 작성하는 콘텐츠 브리프는
//   참조할 수 없다. 대신 문의 단계에서 받은 '사전 설문'(pre_meeting)의 답변으로 제품명·특징을 채운다.
//   특징 우선순위: 장점(q8) → 차별점(q9) → 핵심 메시지(q7) → 사용 상황(q10). 줄바꿈으로 구분해 저장.
export async function fillProductUspFromSurveyAction(docId: string): Promise<R & {
  products?: import("@/lib/mkt-proposal-doc").MktProductItem[]; note?: string;
}> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  if (!doc.brand_id) return { ok: false, error: "브랜드가 연결되지 않은 제안서입니다 — 브랜드 연결 후 실행하세요." };

  const sv = await queryOne<{ answers: Record<string, unknown> | null }>(
    `SELECT answers FROM surveys
      WHERE brand_id=$1 AND kind='pre_meeting' AND responded_at IS NOT NULL
      ORDER BY responded_at DESC LIMIT 1`,
    [doc.brand_id],
  ).catch(() => null);
  if (!sv) return { ok: false, error: "응답 완료된 사전 설문이 없습니다 — 브랜드 360 > 설문에서 발급·회수 후 다시 시도하세요." };

  const a = sv.answers ?? {};
  const str = (k: string) => {
    const v = a[k];
    return Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v.trim() : "";
  };
  // 한 답변에 여러 줄로 적힌 장점은 줄 단위로 분해해 특징 카드로 쓴다.
  const lines = (t: string) => t.split(/\r?\n|·|(?:^|\s)[①②③④⑤]\s*/).map((x) => x.trim()).filter((x) => x.length > 1);
  const feats = [
    ...lines(str("q8_benefits")),
    ...lines(str("q9_difference")),
    ...(str("q7_key_message") ? [str("q7_key_message")] : []),
    ...lines(str("q10_situations")),
  ];
  const uniq: string[] = [];
  for (const f of feats) if (!uniq.some((x) => x === f)) uniq.push(f);
  const features = uniq.slice(0, 5);
  const nameKr = str("product_name_kr") || str("q1_product") || "";
  if (features.length === 0 && !nameKr) {
    return { ok: false, error: "사전 설문에서 제품 특징을 찾지 못했습니다 — 설문 응답 내용을 확인해주세요." };
  }

  // 기존 제품이 있으면 첫 제품의 특징만 채우고(이름은 비어 있을 때만), 없으면 새로 만든다.
  const products = (doc.products_json ?? []).map((p) => ({ ...p }));
  if (products.length === 0) products.push({ name: nameKr || "핵심 SKU", features: [] });
  products[0] = {
    ...products[0],
    name: products[0].name?.trim() || nameKr || products[0].name,
    features: features.length ? features : products[0].features,
  };
  return {
    ok: true, products,
    note: `사전 설문 기준 특징 ${features.length}건 반영${nameKr ? ` · 제품명 「${nameKr}」` : ""} — 확인 후 [저장]을 눌러 반영하세요.`,
  };
}

// ── 상품 링크 → 제품명·영문명·용량·특징 자동 채움 ──────────────
//   설문이 없거나 부실한 경우의 보완 경로. 링크 페이지를 스크레이핑해 이름·이미지를 받고,
//   AI 가 있으면 영문명·용량·특징까지 정리한다(없으면 스크레이핑 값만 채운다).
export async function fillProductFromLinkAction(docId: string, index: number, url: string): Promise<R & {
  product?: import("@/lib/mkt-proposal-doc").MktProductItem; note?: string;
}> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const link = (url ?? "").trim();
  if (!/^https?:\/\//i.test(link)) return { ok: false, error: "상품 링크(http/https)를 입력하세요." };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };

  const { scrapeProductPage, looksLikeCaution } = await import("@/lib/mkt-proposal2");
  const sc = await scrapeProductPage(link).catch(() => null);
  if (!sc?.ok && !sc?.name) return { ok: false, error: "상품 페이지를 읽지 못했습니다 — 링크를 확인하거나 직접 입력해주세요." };

  const base = (doc.products_json ?? [])[index] ?? {};
  const desc = (sc.description ?? "").trim();
  const descUsable = desc.length > 0 && desc.length <= 200 && !looksLikeCaution(desc);
  const product: import("@/lib/mkt-proposal-doc").MktProductItem = {
    ...base,
    name: sc.name || base.name || "",
    image_url: sc.image_url || base.image_url,
    features: descUsable ? [desc] : (base.features ?? []),
  };

  // AI 가 있으면 영문명·용량·특징을 구조화(없으면 위 값 그대로).
  const { aiText, aiEnabled } = await import("@/lib/ai");
  if (aiEnabled()) {
    const raw = await aiText({
      system: "상품 페이지 정보를 구조화하는 도우미. 페이지에 없는 내용은 지어내지 않는다. JSON 만 출력한다.",
      user:
        `아래 상품 페이지 정보에서 JSON 으로만 답하세요.\n` +
        `{"name_kr":"국문 제품명","name_en":"영문 제품명","volume":"용량(예: 100ml)","features":["핵심 특징 3개 이내"]}\n` +
        `없는 값은 빈 문자열/빈 배열로 두세요.\n\n` +
        `제품명: ${sc.name}\n설명: ${desc.slice(0, 600)}\nURL: ${link}`,
    }).catch(() => null);
    const m = (raw ?? "").match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]) as { name_kr?: string; name_en?: string; volume?: string; features?: unknown };
        if (j.name_kr?.trim()) product.name = j.name_kr.trim();
        if (j.name_en?.trim()) product.name_en = j.name_en.trim();
        if (j.volume?.trim()) product.volume = j.volume.trim();
        const fs = Array.isArray(j.features) ? j.features.map((x) => String(x).trim()).filter(Boolean) : [];
        if (fs.length) product.features = fs.slice(0, 5);
      } catch { /* AI 응답이 깨지면 스크레이핑 값 유지 */ }
    }
  }
  return { ok: true, product, note: `상품 링크에서 제품 정보를 불러왔습니다${aiEnabled() ? "" : " (AI 미설정 — 이름·이미지만)"}.` };
}

// ── 운영 제안서 레퍼런스 가져오기 ─────────────────────────────
//   마케팅 제안은 보통 운영대행 제안 다음에 나가므로, 그때 이미 나갔던 레퍼런스를
//   출발점으로 삼고 여기에 추가하는 흐름이 맞다. 같은 브랜드의 최신 운영 제안서에서
//   크리에이터 레퍼런스를 그대로 가져온다(이미 있는 항목은 링크·핸들 기준으로 중복 제외).
export async function importOpsRefsAction(docId: string): Promise<R & { refs?: MktReferenceItem[]; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  if (!doc.brand_id) return { ok: false, error: "브랜드가 연결되지 않은 제안서입니다 — 브랜드 연결 후 실행하세요." };

  const ops = await queryOne<{ id: string; title: string; creators: unknown; updated_at: string }>(
    `SELECT id, title, creators, updated_at FROM proposal_docs
      WHERE brand_id=$1 AND jsonb_array_length(COALESCE(creators,'[]'::jsonb)) > 0
      ORDER BY updated_at DESC LIMIT 1`,
    [doc.brand_id],
  ).catch(() => null);
  if (!ops) return { ok: false, error: "이 브랜드의 운영 제안서에 저장된 레퍼런스가 없습니다." };

  const creators = Array.isArray(ops.creators) ? (ops.creators as Record<string, unknown>[]) : [];
  // 중복 판정 키 — 콘텐츠 링크 우선, 없으면 핸들.
  const keyOf = (link?: unknown, creator?: unknown) =>
    (String(link ?? "").trim() || String(creator ?? "").trim().replace(/^@+/, "")).toLowerCase();
  const have = new Set((doc.references_json ?? []).map((r) => keyOf(r.url, r.creator)).filter(Boolean));

  const incoming: MktReferenceItem[] = [];
  for (const c of creators) {
    const k = keyOf(c.link, c.handle);
    if (!k || have.has(k)) continue;
    have.add(k);
    incoming.push({
      creator: String(c.handle ?? ""),
      product: String(c.product ?? c.brand ?? ""),
      gmv: String(c.revenue ?? "") || undefined,
      roas: String(c.roas ?? "") || undefined,
      engagement: String(c.engagement ?? "") || undefined,
      image_url: String(c.thumb_url ?? "") || undefined,
      url: String(c.link ?? "") || undefined,
    });
  }
  if (incoming.length === 0) return { ok: false, error: "가져올 새 레퍼런스가 없습니다(이미 모두 반영됨)." };
  return {
    ok: true, refs: incoming,
    note: `운영 제안서 '${ops.title}' 에서 ${incoming.length}건 가져옴 — 확인 후 [저장]을 눌러 반영하세요.`,
  };
}

/** 파이프라인 연동 — 브랜드의 마케팅 프로젝트 카드를 만들거나 찾아 연결하고 상태를 반영. */
export async function linkMktProposalToPipelineAction(id: string): Promise<R & { projectId?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getMktProposalById(id);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  if (!doc.brand_id) return { ok: false, error: "브랜드가 연결되지 않은 제안서입니다." };
  try {
    let projectId = doc.mkt_project_id ?? "";
    // 기존 연결 프로젝트가 유효한지 확인.
    if (projectId) {
      const ex = await queryOne<{ id: string }>("SELECT id FROM mkt_projects WHERE id=$1", [projectId]).catch(() => null);
      if (!ex) projectId = "";
    }
    // 없으면 이 브랜드의 마케팅 프로젝트를 찾거나 새로 생성.
    if (!projectId) {
      const existing = await queryOne<{ id: string }>(
        "SELECT id FROM mkt_projects WHERE brand_id=$1 AND kind<>'routine' ORDER BY created_at DESC LIMIT 1", [doc.brand_id],
      ).catch(() => null);
      if (existing) projectId = existing.id;
      else {
        const row = await queryOne<{ id: string }>(
          "INSERT INTO mkt_projects (brand_id, title, proposal_status) VALUES ($1,$2,$3) RETURNING id",
          [doc.brand_id, doc.title || "마케팅 프로젝트", PROJ_STATUS[doc.status] ?? "draft"],
        );
        projectId = row!.id;
      }
    }
    // 상태 반영 + 문서에 링크 저장.
    await query("UPDATE mkt_projects SET proposal_status=$2, updated_at=now() WHERE id=$1", [projectId, PROJ_STATUS[doc.status] ?? "draft"]).catch(() => {});
    await query("UPDATE mkt_proposal_docs SET mkt_project_id=$2, updated_at=now() WHERE id=$1", [id, projectId]);
    revalidatePath("/mkt-proposals");
    revalidatePath("/mkt");
    return { ok: true, projectId };
  } catch (e) { return { ok: false, error: friendlyError(e, "마케팅 제안서") }; }
}
