"use server";

// QnA 지식베이스 화면 전용 서버액션.
// (@/app/actions.ts 는 수정 금지 규칙에 따라 이 화면 전용 파일로 분리)
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { aiText, aiEnabled } from "@/lib/ai";

export interface QnaActionResult {
  ok: boolean;
  error?: string;
}

function isLead(role: string): boolean {
  return role === "lead" || role === "exec";
}

/** 직접 등록 — 담당자가 QnA를 신규 등록(승인 전 상태). */
export async function createQnaAction(input: {
  question: string;
  answer?: string;
  category?: string;
}): Promise<QnaActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, error: "질문을 입력하세요." };
  await query(
    `INSERT INTO qna_entries (question, answer, category, approved)
     VALUES ($1, $2, $3, false)`,
    [question, (input.answer ?? "").trim(), (input.category ?? "").trim()],
  );
  revalidatePath("/qna");
  return { ok: true };
}

/** 답변 작성/수정 — 담당자. 승인 상태는 건드리지 않음(파트장 승인 게이트 유지). */
export async function saveQnaAnswerAction(id: string, answer: string): Promise<QnaActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const body = (answer ?? "").trim();
  if (!body) return { ok: false, error: "답변 내용을 입력하세요." };
  await query(`UPDATE qna_entries SET answer=$2 WHERE id=$1`, [id, body]);
  revalidatePath("/qna");
  return { ok: true };
}

/** 승인(지식화) — 파트장/대표만. 답변이 있어야 승인 가능. */
export async function approveQnaAction(id: string): Promise<QnaActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!isLead(u.role)) return { ok: false, error: "권한 없음 (승인은 파트장/대표만)" };
  const row = await queryOne<{ answer: string | null }>(
    `SELECT answer FROM qna_entries WHERE id=$1`,
    [id],
  );
  if (!row) return { ok: false, error: "항목을 찾을 수 없습니다." };
  if (!(row.answer ?? "").trim()) return { ok: false, error: "답변이 작성돼야 승인할 수 있습니다." };
  await query(`UPDATE qna_entries SET approved=true WHERE id=$1`, [id]);
  revalidatePath("/qna");
  return { ok: true };
}

/** 승인 취소 — 파트장/대표만(잘못 지식화된 항목 회수). */
export async function unapproveQnaAction(id: string): Promise<QnaActionResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!isLead(u.role)) return { ok: false, error: "권한 없음 (파트장/대표만)" };
  await query(`UPDATE qna_entries SET approved=false WHERE id=$1`, [id]);
  revalidatePath("/qna");
  return { ok: true };
}

export interface QnaSuggestResult extends QnaActionResult {
  draft?: string;
  usedCount?: number;
}

/**
 * AI 답변 추천 — 승인된 지식베이스(qna_entries)의 유사 항목을 근거로 답변 초안 생성.
 *   · 저장/승인은 하지 않는다(기존 액션 재사용). 초안 텍스트만 반환.
 *   · 판정(등급·게이트·정산)은 하지 않고 문구·요약·안내만. 개인정보는 프롬프트/출력 금지.
 */
export async function suggestQnaAnswerAction(input: {
  question: string;
  category?: string;
}): Promise<QnaSuggestResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const question = (input.question ?? "").trim();
  if (!question) return { ok: false, error: "질문을 먼저 입력하세요." };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  const category = (input.category ?? "").trim();

  // 근거 후보: 승인·답변 보유 항목만(미승인 지식은 근거로 쓰지 않음).
  const kb = await query<{
    question: string;
    answer: string;
    category: string | null;
    usage_count: number;
  }>(
    `SELECT question, answer, category, usage_count
       FROM qna_entries
      WHERE approved = true AND answer IS NOT NULL AND btrim(answer) <> ''
      ORDER BY usage_count DESC, created_at DESC
      LIMIT 200`,
  ).catch(() => [] as { question: string; answer: string; category: string | null; usage_count: number }[]);

  // 토큰 겹침 기반 유사도 랭킹(같은 카테고리 가산).
  const tokens = question
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/)
    .filter((t) => t.length >= 2);
  const scored = kb
    .map((r) => {
      const hay = `${r.question} ${r.answer}`.toLowerCase();
      let s = tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
      if (category && (r.category || "").trim() === category) s += 2;
      return { r, s };
    })
    .sort((a, b) => b.s - a.s);

  const matched = scored.filter((x) => x.s > 0).slice(0, 5).map((x) => x.r);
  const refs = matched.length ? matched : kb.slice(0, 3); // 겹침 없으면 상위 재사용 항목으로 톤만 참고

  const context = refs
    .map(
      (r, i) =>
        `[${i + 1}] (카테고리: ${(r.category || "일반").trim()}) Q: ${r.question}\nA: ${r.answer}`,
    )
    .join("\n\n");

  const system = `너는 GloveK(틱톡샵 해외진출 대행사)의 CS 담당자다. 아래 "승인된 지식베이스"를 근거로 고객 질문에 대한 한국어 답변 초안을 작성한다.
규칙:
- 지식베이스에 근거가 있으면 그 내용을 활용하고, 근거가 부족하면 확정적이지 않은 일반 안내로 작성한다.
- 등급 판정·발송 게이트·정산 금액 산정 같은 판정은 하지 말고, 문구·요약·안내만 작성한다.
- 개인정보(카드번호·신분증·비밀번호)는 절대 요청하거나 포함하지 않는다.
- 정중하고 간결하게. 답변 본문만 출력한다(머리말·메타설명 없이).`;

  const user = `고객 질문: "${question}"${category ? `\n카테고리: ${category}` : ""}

승인된 지식베이스(근거):
${context || "(관련 근거 없음)"}

위 근거를 바탕으로 답변 초안을 작성해줘.`;

  const draft = await aiText({ system, user, maxTokens: 800 }).catch(() => null);
  if (!draft) return { ok: false, error: "AI 초안 생성 실패 (잠시 후 재시도)" };
  return { ok: true, draft: draft.trim(), usedCount: matched.length };
}
