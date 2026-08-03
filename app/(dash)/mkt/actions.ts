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

/** 마케팅 제안서 작성 — 브랜드·제목·금액·기간·범위 메모 → proposals(kind='marketing'). */
export async function createMktProposalAction(input: {
  brand_id: string;
  title: string;
  amount?: string;
  period_start?: string;
  period_end?: string;
  note?: string;
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

  const b = await queryOne<{ id: string }>("SELECT id FROM brands WHERE id=$1", [input.brand_id]);
  if (!b) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  await query(
    `INSERT INTO proposals (brand_id, kind, title, amount, period_start, period_end, note, status, created_by)
     VALUES ($1,'marketing',$2,$3,$4,$5,$6,'draft',$7)`,
    [input.brand_id, title, amount, ps || null, pe || null, (input.note ?? "").trim(), `admin:${u.id}`],
  );
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
    period_start: string | null; period_end: string | null; note: string | null;
    brand_name: string; email: string | null;
  }>(
    `SELECT p.id, p.brand_id, p.title, p.amount, p.period_start, p.period_end, p.note,
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
  revalidatePath("/mkt");
  revalidatePath(`/brand/${cur.brand_id}`);
  return { ok: true };
}
