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

/**
 * 일괄 가져오기(붙여넣기) — 외부 FAQ 문서를 붙여넣어 다건 등록.
 *   형식(유연): `[카테고리]` 줄로 카테고리 지정, `Q:`/`Q.` 로 질문, `A:`/`A.` 로 답변(다음 Q 전까지 다중행).
 *   approve=true 면 바로 승인(외부 공개 노출). 중복(같은 질문)은 건너뜀.
 */
export async function importQnaAction(input: { text: string; approve?: boolean }): Promise<QnaActionResult & { added?: number; skipped?: number }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  const approve = input.approve !== false;
  if (approve && !isLead(u.role)) return { ok: false, error: "즉시 공개(승인) 등록은 파트장/대표만 — 승인 없이 등록하려면 체크 해제" };
  const text = (input.text ?? "").trim();
  if (!text) return { ok: false, error: "가져올 내용을 붙여넣으세요." };

  // 파싱: [카테고리] / Q: / A: 블록.
  const items: { category: string; question: string; answer: string }[] = [];
  let cat = "";
  let cur: { question: string; answer: string } | null = null;
  let mode: "q" | "a" | null = null;
  const push = () => { if (cur && cur.question.trim()) items.push({ category: cat, question: cur.question.trim(), answer: cur.answer.trim() }); cur = null; mode = null; };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const catM = line.match(/^\s*[\[【](.+?)[\]】]\s*$/);
    if (catM) { push(); cat = catM[1].trim(); continue; }
    const qM = line.match(/^\s*(?:Q|질문)\s*[:.．]\s*(.*)$/i);
    if (qM) { push(); cur = { question: qM[1], answer: "" }; mode = "q"; continue; }
    const aM = line.match(/^\s*(?:A|답변|답)\s*[:.．]\s*(.*)$/i);
    if (aM) { if (!cur) cur = { question: "", answer: "" }; cur.answer = aM[1]; mode = "a"; continue; }
    // 연속 행 — 현재 모드에 이어 붙임.
    if (cur && mode === "q") cur.question += (cur.question ? " " : "") + line;
    else if (cur && mode === "a") cur.answer += (cur.answer ? "\n" : "") + line;
  }
  push();

  if (items.length === 0) return { ok: false, error: "질문을 찾지 못했습니다 — 각 항목을 'Q: 질문' / 'A: 답변' 형식으로 작성하세요." };

  let added = 0, skipped = 0;
  for (const it of items) {
    const dup = await queryOne<{ id: string }>("SELECT id FROM qna_entries WHERE question=$1", [it.question]).catch(() => null);
    if (dup) { skipped++; continue; }
    const ok = await queryOne<{ id: string }>(
      `INSERT INTO qna_entries (question, answer, category, approved, source_ref)
       VALUES ($1,$2,$3,$4,'import') RETURNING id`,
      [it.question, it.answer, it.category, approve && Boolean(it.answer.trim())],
    ).catch(() => null);
    if (ok) added++; else skipped++;
  }
  revalidatePath("/qna");
  revalidatePath("/faq");
  return { ok: true, added, skipped };
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
