"use server";

// mkt 화면 전용 서버액션. @/app/actions.ts 는 수정하지 않는다(충돌 방지).
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

const STATUSES = ["draft", "sent", "negotiating", "won", "dropped"] as const;
type MktStatus = (typeof STATUSES)[number];

export interface MktResult {
  ok: boolean;
  error?: string;
}

/**
 * 파이프라인 카드 이동 — mkt_projects.proposal_status 변경.
 * 게이트: 수주(won)로 이동하려면 해당 브랜드에 계약이 1건 이상 등록돼 있어야 한다
 *         (화면 안내 "수주→진행은 계약 등록이 필요합니다"와 일치).
 */
export async function setMktStatusAction(id: string, to: string): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!STATUSES.includes(to as MktStatus)) return { ok: false, error: "잘못된 상태값" };

  const proj = await queryOne<{ brand_id: string }>(
    "SELECT brand_id FROM mkt_projects WHERE id=$1",
    [id],
  );
  if (!proj) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  if (to === "won") {
    const c = await queryOne<{ n: string }>(
      "SELECT count(*)::text AS n FROM contracts WHERE brand_id=$1",
      [proj.brand_id],
    );
    if (!c || Number(c.n) === 0) {
      return { ok: false, error: "수주로 이동하려면 계약 등록이 필요합니다 (브랜드 카드에서 계약 추가)." };
    }
  }

  await query(
    "UPDATE mkt_projects SET proposal_status=$2, updated_at=now() WHERE id=$1",
    [id, to],
  );
  revalidatePath("/mkt");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 마케팅 제안서 (기획확정 7절) — proposals(kind='marketing') 저장,
// 발송은 초안함(email_drafts) 경유: 여기서는 초안까지만 만들고
// 담당 승인·발송은 /drafts 의 approveAndSend(수신동의 게이트) 로만 진행한다.
// ─────────────────────────────────────────────────────────────

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 리드 없는 브랜드를 마케팅용으로 직접 등록(예: 클리오 — 운영대행 없이 캠페인만).
 *   파이프라인엔 안 올라오도록 source='mkt_direct'. 이메일/전화 없이도 생성 허용. */
export async function registerMktBrandAction(input: { brand_name: string; email?: string; category?: string; memo?: string }): Promise<MktResult & { brand_id?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const name = (input.brand_name ?? "").trim();
  if (!name) return { ok: false, error: "브랜드명을 입력하세요." };
  // 유입담당 기본값 = 등록한 담당자(수동 등록이므로 시스템 소스 아님).
  const row = await queryOne<{ id: string }>(
    `INSERT INTO brands (brand_name, email, category, source, state, memo, owner_intake)
     VALUES ($1,$2,$3,'mkt_direct','lead_new',$4,$5) RETURNING id`,
    [name, (input.email ?? "").trim() || null, (input.category ?? "").trim(), (input.memo ?? "").trim(), u.id],
  ).catch(() => null);
  if (!row) return { ok: false, error: "등록 실패(중복 이메일/전화 확인)" };
  revalidatePath("/mkt");
  return { ok: true, brand_id: row.id };
}

/** 개별 프로젝트 신규 등록 — 파이프라인 보드(mkt_projects)에 직접 카드 생성.
 *   proposal_id 를 넘기면 해당 마케팅 제안서와 연결된 프로젝트로 만든다. */
export async function createMktProjectAction(input: {
  brand_id: string;
  title: string;
  note?: string;
  kind?: "project" | "routine";
  proposal_id?: string;
}): Promise<MktResult & { id?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "프로젝트명을 입력하세요." };
  const kind = input.kind === "routine" ? "routine" : "project";
  const b = await queryOne<{ id: string }>("SELECT id FROM brands WHERE id=$1", [input.brand_id]);
  if (!b) return { ok: false, error: "브랜드를 찾을 수 없습니다." };
  const row = await queryOne<{ id: string }>(
    `INSERT INTO mkt_projects (brand_id, kind, title, note, proposal_status, proposal_id)
     VALUES ($1,$2,$3,$4,'draft',$5) RETURNING id`,
    [input.brand_id, kind, title, (input.note ?? "").trim(), input.proposal_id ?? null],
  ).catch(() => null);
  if (!row) return { ok: false, error: "프로젝트 등록 실패" };
  revalidatePath("/mkt");
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true, id: row.id };
}

/** 개별 프로젝트 상세 수정 — 제목·메모. */
export async function updateMktProjectAction(input: { id: string; title?: string; note?: string }): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.id) return { ok: false, error: "프로젝트 ID 누락" };
  const title = (input.title ?? "").trim();
  if (input.title !== undefined && !title) return { ok: false, error: "프로젝트명을 비울 수 없습니다." };
  const cur = await queryOne<{ brand_id: string }>("SELECT brand_id FROM mkt_projects WHERE id=$1", [input.id]).catch(() => null);
  if (!cur) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  await query(
    `UPDATE mkt_projects SET title=COALESCE($2,title), note=$3, updated_at=now() WHERE id=$1`,
    [input.id, input.title !== undefined ? title : null, (input.note ?? "").trim()],
  );
  revalidatePath("/mkt");
  revalidatePath(`/brand/${cur.brand_id}`);
  return { ok: true };
}

/** 개별 프로젝트(카드) 완전 삭제 — 세부 내용까지 제거. 연결된 제안서(proposals)는 유지. */
export async function deleteMktProjectAction(id: string): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!id) return { ok: false, error: "프로젝트 ID 누락" };
  const cur = await queryOne<{ brand_id: string }>("SELECT brand_id FROM mkt_projects WHERE id=$1", [id]).catch(() => null);
  if (!cur) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  await query("DELETE FROM mkt_projects WHERE id=$1", [id]);
  revalidatePath("/mkt");
  revalidatePath(`/brand/${cur.brand_id}`);
  return { ok: true };
}

/** 기존 프로젝트에 마케팅 제안서를 만들어 연결 — 신규프로젝트=마케팅제안서 일치(2-3).
 *   제안서 미연결 카드를 제안서 기반으로 승격시킨다. */
export async function createProposalForProjectAction(projectId: string): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const p = await queryOne<{ brand_id: string; title: string; note: string | null; proposal_id: string | null }>(
    "SELECT brand_id, title, note, proposal_id FROM mkt_projects WHERE id=$1", [projectId],
  ).catch(() => null);
  if (!p) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };
  if (p.proposal_id) return { ok: false, error: "이미 제안서가 연결돼 있습니다." };
  const prow = await queryOne<{ id: string }>(
    `INSERT INTO proposals (brand_id, kind, title, note, status, created_by)
     VALUES ($1,'marketing',$2,$3,'draft',$4) RETURNING id`,
    [p.brand_id, p.title, (p.note ?? "").trim(), `admin:${u.id}`],
  ).catch(() => null);
  if (!prow) return { ok: false, error: "제안서 생성 실패" };
  await query("UPDATE mkt_projects SET proposal_id=$2, updated_at=now() WHERE id=$1", [projectId, prow.id]);
  revalidatePath("/mkt");
  revalidatePath(`/brand/${p.brand_id}`);
  return { ok: true };
}

/** 마케팅 제안서 작성 — 브랜드·제목·금액·기간·범위 메모 → proposals(kind='marketing').
 *   link_project(기본 true)면 파이프라인 개별 프로젝트를 자동 생성·연결한다. */
export async function createMktProposalAction(input: {
  brand_id: string;
  title: string;
  amount?: string;
  period_start?: string;
  period_end?: string;
  note?: string;
  file_url?: string;  // 개별 제안서 파일 링크(드라이브 PPT/PDF)
  propose_date?: string;    // 제안 예정일
  final_due_date?: string;  // 최종 제안 예정 일정
  rfp_text?: string;        // 사전 RFP(설문/직접)
  rfp_file_url?: string;    // RFP 업로드 링크
  ai_direction?: string;    // AI 제안 방향
  link_project?: boolean; // 파이프라인 프로젝트 자동 생성·연결(기본 true)
}): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "제목을 입력하세요." };

  let amount: number | null = null;
  if (input.amount && input.amount.trim()) {
    amount = Number(input.amount.replace(/[, ]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "금액이 올바르지 않습니다." };
    amount = Math.round(amount);
  }
  const ps = (input.period_start ?? "").trim();
  const pe = (input.period_end ?? "").trim();
  if (ps && !isYmd(ps)) return { ok: false, error: "기간 시작일 형식(YYYY-MM-DD)을 확인하세요." };
  if (pe && !isYmd(pe)) return { ok: false, error: "기간 종료일 형식(YYYY-MM-DD)을 확인하세요." };
  if (ps && pe && ps > pe) return { ok: false, error: "기간 시작일이 종료일보다 늦습니다." };
  const pd = (input.propose_date ?? "").trim();
  const fd = (input.final_due_date ?? "").trim();
  if (pd && !isYmd(pd)) return { ok: false, error: "제안 예정일 형식(YYYY-MM-DD)을 확인하세요." };
  if (fd && !isYmd(fd)) return { ok: false, error: "최종 제안 예정일 형식(YYYY-MM-DD)을 확인하세요." };

  const b = await queryOne<{ id: string }>("SELECT id FROM brands WHERE id=$1", [input.brand_id]);
  if (!b) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 신규 컬럼(0064) 포함 INSERT 시도 → 컬럼 미존재(마이그레이션 미적용) 시 기본 컬럼으로 폴백.
  let prow: { id: string } | null = null;
  try {
    prow = await queryOne<{ id: string }>(
      `INSERT INTO proposals (brand_id, kind, title, amount, period_start, period_end, note, url,
                              propose_date, final_due_date, rfp_text, rfp_file_url, ai_direction, status, created_by)
       VALUES ($1,'marketing',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14) RETURNING id`,
      [input.brand_id, title, amount, ps || null, pe || null, (input.note ?? "").trim(), (input.file_url ?? "").trim(),
       pd || null, fd || null, (input.rfp_text ?? "").trim() || null, (input.rfp_file_url ?? "").trim() || null,
       (input.ai_direction ?? "").trim() || null, `admin:${u.id}`],
    );
  } catch (e) {
    if (/column .* does not exist|propose_date|final_due_date|rfp_text|rfp_file_url|ai_direction/i.test((e as Error).message)) {
      prow = await queryOne<{ id: string }>(
        `INSERT INTO proposals (brand_id, kind, title, amount, period_start, period_end, note, url, status, created_by)
         VALUES ($1,'marketing',$2,$3,$4,$5,$6,$7,'draft',$8) RETURNING id`,
        [input.brand_id, title, amount, ps || null, pe || null, (input.note ?? "").trim(), (input.file_url ?? "").trim(), `admin:${u.id}`],
      );
    } else throw e;
  }
  if (!prow) return { ok: false, error: "제안서 저장 실패" };

  // 파이프라인 개별 프로젝트 자동 생성·연결(기본 동작). 실패해도 제안서 저장은 유지.
  if (input.link_project !== false) {
    await query(
      `INSERT INTO mkt_projects (brand_id, kind, title, note, proposal_status, proposal_id)
       VALUES ($1,'project',$2,$3,'draft',$4)`,
      [input.brand_id, title, (input.note ?? "").trim(), prow.id],
    ).catch((e) => console.error("[mkt] 프로젝트 자동연결 실패:", (e as Error).message));
  }

  revalidatePath("/mkt");
  revalidatePath(`/brand/${input.brand_id}`);
  return { ok: true };
}

/**
 * 마케팅 제안서 발송 준비 — email_drafts(kind='mkt_proposal', proposal_id 연결) 초안 생성.
 * 실제 발송은 초안함에서 담당 승인 시(approveAndSend · 수신동의 게이트) 이뤄진다.
 */
export async function draftMktProposalEmailAction(proposalId: string): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!proposalId) return { ok: false, error: "제안서 ID 누락" };

  const p = await queryOne<{
    id: string; brand_id: string; title: string | null; amount: number | null;
    period_start: string | null; period_end: string | null; note: string | null; url: string | null;
    brand_name: string; email: string | null;
  }>(
    `SELECT p.id, p.brand_id, p.title, p.amount, p.period_start, p.period_end, p.note, p.url,
            b.brand_name, b.email
       FROM proposals p JOIN brands b ON b.id=p.brand_id
      WHERE p.id=$1 AND p.kind='marketing'`,
    [proposalId],
  );
  if (!p) return { ok: false, error: "마케팅 제안서를 찾을 수 없습니다." };
  if (!p.email) return { ok: false, error: "브랜드 이메일이 없습니다 — 회사정보에서 입력하세요." };

  // 중복 방지: 같은 제안서로 대기 중(draft) 초안이 이미 있으면 새로 만들지 않는다.
  const dup = await queryOne<{ id: string }>(
    "SELECT id FROM email_drafts WHERE proposal_id=$1 AND status='draft'",
    [proposalId],
  ).catch(() => null);
  if (dup) return { ok: false, error: "이미 초안함에 대기 중인 발송 초안이 있습니다." };

  const period =
    p.period_start || p.period_end
      ? `${p.period_start ?? "미정"} ~ ${p.period_end ?? "미정"}`
      : null;
  const subject = `[GloveK] ${p.brand_name} 마케팅 제안서 — ${p.title ?? "제안"}`;
  const body = [
    `안녕하세요, ${p.brand_name} 담당자님.`,
    "",
    `GloveK 마케팅 제안을 안내드립니다.`,
    `· 제안: ${p.title ?? "-"}`,
    p.amount != null ? `· 제안 금액: ${p.amount.toLocaleString("ko-KR")}원` : null,
    period ? `· 제안 기간: ${period}` : null,
    p.note ? `· 범위: ${p.note}` : null,
    p.url ? `· 제안서 파일: ${p.url}` : null,
    "",
    "검토 후 회신 주시면 상세 자료와 함께 미팅을 잡아드리겠습니다.",
    "",
    "감사합니다.",
    "GloveK 드림",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const row = await queryOne<{ id: string }>(
    `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status, proposal_id)
     VALUES ($1,'mkt_proposal',$2,$3,$4,'draft',$5) RETURNING id`,
    [p.brand_id, p.email, subject, body, proposalId],
  );
  if (!row) return { ok: false, error: "초안 저장 실패" };

  revalidatePath("/mkt");
  revalidatePath("/drafts");
  return { ok: true };
}

/** 브랜드 설문에서 사전 RFP 초안 불러오기(제안서 작성 폼용). */
export async function pullRfpFromSurveyAction(brandId: string): Promise<MktResult & { rfp?: string; from?: string | null }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!brandId) return { ok: false, error: "브랜드를 선택하세요." };
  const { brandRfpFromSurvey } = await import("@/lib/mkt-proposal");
  const r = await brandRfpFromSurvey(brandId).catch(() => ({ rfp: "", from: null }));
  if (!r.rfp) return { ok: false, error: "이 브랜드의 설문 응답이 없습니다 — RFP 를 직접 입력/업로드하세요." };
  return { ok: true, rfp: r.rfp, from: r.from };
}

/** 예산·RFP·우리 서비스 기반 AI 제안 방향 생성(폼 미리보기용 — 저장은 별도). */
export async function generateDirectionDraftAction(input: { brand_id: string; amount?: string; rfp?: string }): Promise<MktResult & { direction?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.brand_id) return { ok: false, error: "브랜드를 선택하세요." };
  const b = await queryOne<{ brand_name: string; category: string | null }>("SELECT brand_name, category FROM brands WHERE id=$1", [input.brand_id]).catch(() => null);
  if (!b) return { ok: false, error: "브랜드를 찾을 수 없습니다." };
  let amount: number | null = null;
  if (input.amount && input.amount.trim()) { amount = Number(input.amount.replace(/[, ]/g, "")); if (!Number.isFinite(amount)) amount = null; }
  const { generateProposalDirection } = await import("@/lib/mkt-proposal");
  const direction = await generateProposalDirection({ brandName: b.brand_name, category: b.category, amount, rfp: input.rfp });
  return { ok: true, direction };
}

/** 기존 마케팅 제안서의 AI 제안 방향 재생성·저장(예산·RFP·우리 서비스 최신 반영). */
export async function regenerateDirectionAction(proposalId: string): Promise<MktResult & { direction?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  let p: { brand_id: string; amount: number | null; rfp_text: string | null; brand_name: string; category: string | null } | null;
  try {
    p = await queryOne(
      `SELECT p.brand_id, p.amount, p.rfp_text, b.brand_name, b.category
         FROM proposals p JOIN brands b ON b.id=p.brand_id WHERE p.id=$1 AND p.kind='marketing'`,
      [proposalId]);
  } catch (e) {
    if (/rfp_text|column .* does not exist/i.test((e as Error).message)) return { ok: false, error: "마이그레이션(0064) 적용이 필요합니다(관리자)." };
    throw e;
  }
  if (!p) return { ok: false, error: "마케팅 제안서를 찾을 수 없습니다." };
  const { generateProposalDirection } = await import("@/lib/mkt-proposal");
  const direction = await generateProposalDirection({ brandName: p.brand_name, category: p.category, amount: p.amount, rfp: p.rfp_text });
  const upd = await query("UPDATE proposals SET ai_direction=$2 WHERE id=$1", [proposalId, direction]).then(() => true).catch(() => false);
  if (!upd) return { ok: false, error: "마이그레이션(0064) 적용이 필요합니다(관리자)." };
  revalidatePath("/mkt");
  return { ok: true, direction };
}

/** 마케팅 제안서 메타 수정 — 제안 예정일·최종 일정·RFP·제안방향·금액. */
export async function updateMktProposalMetaAction(input: {
  id: string; propose_date?: string; final_due_date?: string; rfp_text?: string; rfp_file_url?: string; ai_direction?: string; amount?: string;
}): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const cur = await queryOne<{ brand_id: string }>("SELECT brand_id FROM proposals WHERE id=$1 AND kind='marketing'", [input.id]).catch(() => null);
  if (!cur) return { ok: false, error: "마케팅 제안서를 찾을 수 없습니다." };
  const pd = (input.propose_date ?? "").trim();
  const fd = (input.final_due_date ?? "").trim();
  if (pd && !isYmd(pd)) return { ok: false, error: "제안 예정일 형식(YYYY-MM-DD)을 확인하세요." };
  if (fd && !isYmd(fd)) return { ok: false, error: "최종 제안 예정일 형식(YYYY-MM-DD)을 확인하세요." };
  let amount: number | null | undefined = undefined;
  if (input.amount !== undefined) { const n = Number((input.amount || "").replace(/[, ]/g, "")); amount = input.amount.trim() && Number.isFinite(n) ? Math.round(n) : null; }
  const ok = await query(
    `UPDATE proposals SET
       propose_date = COALESCE($2::date, propose_date),
       final_due_date = COALESCE($3::date, final_due_date),
       rfp_text = COALESCE($4, rfp_text),
       rfp_file_url = COALESCE($5, rfp_file_url),
       ai_direction = COALESCE($6, ai_direction),
       amount = COALESCE($7, amount)
     WHERE id=$1`,
    [input.id, pd || null, fd || null,
     input.rfp_text !== undefined ? input.rfp_text : null,
     input.rfp_file_url !== undefined ? input.rfp_file_url : null,
     input.ai_direction !== undefined ? input.ai_direction : null,
     amount ?? null],
  ).then(() => true).catch(() => false);
  if (!ok) return { ok: false, error: "마이그레이션(0064) 적용이 필요합니다(관리자)." };
  revalidatePath("/mkt");
  revalidatePath(`/brand/${cur.brand_id}`);
  return { ok: true };
}

/** 설정 — 마케팅 제안 AI 참고용 '우리 서비스 소개' 저장(파트장/대표). */
export async function saveMktServicesAction(md: string): Promise<MktResult> {
  const u = await currentUser();
  if (!u || (u.role !== "lead" && u.role !== "exec")) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  const { saveMktServices } = await import("@/lib/mkt-proposal");
  await saveMktServices(md ?? "");
  revalidatePath("/settings");
  revalidatePath("/mkt");
  return { ok: true };
}

/** 마케팅 제안서 상태 스텝 — draft→sent 는 초안함 발송(sent) 확인 후에만 허용. */
const MKT_PROPOSAL_NEXT: Record<string, string[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected"],
};

export async function setMktProposalStatusAction(id: string, to: string): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const cur = await queryOne<{ status: string; brand_id: string }>(
    "SELECT status, brand_id FROM proposals WHERE id=$1 AND kind='marketing'",
    [id],
  );
  if (!cur) return { ok: false, error: "마케팅 제안서를 찾을 수 없습니다." };
  const allowed = MKT_PROPOSAL_NEXT[cur.status] ?? [];
  if (!allowed.includes(to)) {
    return { ok: false, error: `'${cur.status}' → '${to}' 전이는 허용되지 않습니다.` };
  }
  if (to === "sent") {
    // 게이트: 초안함 경유 실제 발송(email_drafts.status='sent')이 있어야 발송 처리.
    const sent = await queryOne<{ id: string }>(
      "SELECT id FROM email_drafts WHERE proposal_id=$1 AND status='sent'",
      [id],
    ).catch(() => null);
    if (!sent) return { ok: false, error: "초안함에서 승인·발송된 기록이 없습니다 — 발송 준비 후 초안함에서 승인하세요." };
    await query("UPDATE proposals SET status='sent', sent_at=now() WHERE id=$1", [id]);
  } else {
    await query("UPDATE proposals SET status=$2, decided_at=now() WHERE id=$1", [id, to]);
  }

  // 연결된 파이프라인 프로젝트에 상태 반영(발송→발송, 수락→수주, 거절→드랍).
  const projStatus = to === "accepted" ? "won" : to === "rejected" ? "dropped" : to === "sent" ? "sent" : null;
  if (projStatus) {
    await query(
      "UPDATE mkt_projects SET proposal_status=$2, updated_at=now() WHERE proposal_id=$1",
      [id, projStatus],
    ).catch(() => {});
  }

  revalidatePath("/mkt");
  revalidatePath(`/brand/${cur.brand_id}`);
  return { ok: true };
}
