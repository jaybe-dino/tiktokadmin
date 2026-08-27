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
  fixed?: number; dead?: string[];
  products_json?: import("@/lib/mkt-proposal-doc").MktProductItem[]; references_json?: MktReferenceItem[];
}> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };
  if (!doc.brand_id) return { ok: false, error: "브랜드가 연결되지 않은 제안서입니다 — 브랜드 연결 후 실행하세요." };
  const { pinExternalImage } = await import("@/lib/ref-pin");
  const ext = (v?: string | null) => Boolean(v && /^https?:\/\//i.test(v));
  const dead: string[] = [];
  let fixed = 0;

  const refs = (doc.references_json ?? []).map((r) => ({ ...r }));
  await Promise.all(refs.map(async (r) => {
    if (!ext(r.image_url)) return;
    const pinned = await pinExternalImage(doc.brand_id!, r.image_url, r.url);
    if (pinned) { r.image_url = pinned; fixed++; } else dead.push(`레퍼런스 ${r.creator || r.product || "?"}`);
  }));
  const products = (doc.products_json ?? []).map((p) => ({ ...p }));
  await Promise.all(products.map(async (p) => {
    if (!ext(p.image_url)) return;
    const pinned = await pinExternalImage(doc.brand_id!, p.image_url);
    if (pinned) { p.image_url = pinned; fixed++; } else dead.push(`제품 ${p.name}`);
  }));

  await query(
    `UPDATE mkt_proposal_docs SET products_json=$2::jsonb, references_json=$3::jsonb, updated_at=now() WHERE id=$1`,
    [docId, JSON.stringify(products), JSON.stringify(refs)],
  );
  revalidatePath(`/mkt-proposals/${docId}`);
  return { ok: true, fixed, dead, products_json: products, references_json: refs };
}

// 상태 매핑: 제안서 문서 status → 파이프라인 mkt_projects.proposal_status
const PROJ_STATUS: Record<string, string> = { draft: "draft", sent: "sent", accepted: "won", rejected: "dropped" };

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
