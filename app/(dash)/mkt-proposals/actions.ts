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

type R = { ok: boolean; error?: string };

export async function createMktProposalDocAction(brandId: string): Promise<R & { id?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!brandId) return { ok: false, error: "브랜드를 선택하세요." };
  try {
    const prefill = await prefillMktProposal(brandId);
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

// ── glovek 유사 콘텐츠 레퍼런스 불러오기 ──
//   glovek.space DB(읽기전용)를 직접 조회 — 별도 API 불필요. 키워드 우선순위:
//   ① 에디터의 현재 제품명(설문·상품링크에서 만들어진 products_json, 미저장분 포함)
//   ② 브랜드 카테고리(brands.category / brand_company.product_category).
//   썸네일은 glovek 이 웹에 띄우는 이미지 URL 그대로 — 공개 페이지에선 웹썸네일 프록시로 표시·영구 캐시.
export async function fillGlovekMktRefsAction(
  docId: string, keywords?: string[],
): Promise<R & { refs?: MktReferenceItem[]; note?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const doc = await getMktProposalById(docId);
  if (!doc) return { ok: false, error: "제안서를 찾을 수 없습니다." };

  let kw = (keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (kw.length === 0) {
    kw = (doc.products_json ?? []).flatMap((p) => [p.name_en, p.name]).filter((v): v is string => Boolean(v?.trim()));
  }
  if (kw.length === 0 && doc.brand_id) {
    const b = await queryOne<{ category: string | null; product_category: string | null }>(
      "SELECT b.category, c.product_category FROM brands b LEFT JOIN brand_company c ON c.brand_id=b.id WHERE b.id=$1",
      [doc.brand_id],
    ).catch(() => null);
    const cat = (b?.category || b?.product_category || "").trim();
    if (cat) kw = [cat];
  }
  if (kw.length === 0) return { ok: false, error: "검색 기준이 없습니다 — 제품을 먼저 넣거나 브랜드에 카테고리를 설정하세요." };

  const glovek = await similarProductContent(kw.slice(0, 6), 8).catch(() => []);
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
  const note = `키워드 「${kw.slice(0, 3).join(", ")}」 · glovek 유사 콘텐츠 ${refs.length}건` +
    (refs.length === 0 ? " — 매칭 없음(키워드를 바꾸거나 틱톡 자동조회를 사용하세요)" : "");
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
