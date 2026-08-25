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
import { similarProductContent } from "@/lib/glovek-content";
import { categorySearchTerms } from "@/lib/categories";

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

// ── glovek 유사 콘텐츠 레퍼런스 불러오기(카테고리 선택 기준) ──
//   glovek.space DB(읽기전용)를 직접 조회 — 별도 API 불필요. 키워드가 아니라 담당자가 직접 고른
//   카테고리("스킨케어 > 크림")로 검색한다: 소분류(세부) 우선 → 매칭 없으면 대분류 폴백.
//   카테고리 미지정 시 제안서 저장 카테고리 → 브랜드 카테고리 순 폴백.
//   썸네일은 glovek 이 웹에 띄우는 이미지 URL 그대로 — 공개 페이지에선 웹썸네일 프록시로 표시·영구 캐시.
export async function fillGlovekMktRefsAction(
  docId: string, category?: string,
): Promise<R & { refs?: MktReferenceItem[]; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };

  let cat = (category ?? "").trim() || (doc.category ?? "").trim();
  if (!cat && doc.brand_id) {
    const b = await queryOne<{ category: string | null; product_category: string | null }>(
      "SELECT b.category, c.product_category FROM brands b LEFT JOIN brand_company c ON c.brand_id=b.id WHERE b.id=$1",
      [doc.brand_id],
    ).catch(() => null);
    cat = (b?.category || b?.product_category || "").trim();
  }
  const terms = categorySearchTerms(cat);
  if (terms.length === 0) return { ok: false, error: "카테고리를 선택하세요 (예: 스킨케어 > 크림)." };

  // 소분류 우선 검색 → 결과 없으면 대분류로 폴백.
  let used = terms[0];
  let glovek = await similarProductContent([terms[0]], 8).catch(() => []);
  if (glovek.length === 0 && terms.length > 1) {
    used = terms[1];
    glovek = await similarProductContent([terms[1]], 8).catch(() => []);
  }
  const refs: MktReferenceItem[] = glovek
    .filter((g) => g.handle || g.name || g.image_url)
    .map((g) => ({
      creator: g.handle || undefined,
      product: g.name || undefined,
      gmv: g.gmv || undefined,
      engagement: g.views ? `조회수 ${g.views}` : undefined,
      desc: [g.brand, g.category, g.link].filter(Boolean).join(" · ").slice(0, 180) || undefined,
      image_url: g.image_url || undefined,
      // ROAS·수수료 등 성과 지표는 자동 채우지 않음(허위 방지 — 담당자 입력).
    }));
  const note = `카테고리 「${cat}」(검색어: ${used}) · glovek 유사 콘텐츠 ${refs.length}건` +
    (refs.length === 0 ? " — 매칭 없음(다른 카테고리를 선택하거나 틱톡 자동조회를 사용하세요)" : "");
  return { ok: true, refs: refs.length ? refs : undefined, note };
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
