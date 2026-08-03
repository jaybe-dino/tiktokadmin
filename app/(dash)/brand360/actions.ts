"use server";

// 브랜드360 화면 전용 서버액션.
// (@/app/actions.ts 는 수정 금지 규칙에 따라 이 화면 전용 파일로 분리)
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { aiText, aiEnabled } from "@/lib/ai";
import { STATE_LABELS, type State } from "@/lib/types";

export interface NextActionSuggestResult {
  ok: boolean;
  error?: string;
  draft?: string;
}

/**
 * 다음 액션 제안 AI 초안 — 해당 브랜드의 맥락(사전분석 브리프·현재 단계·기존 다음액션·
 * 최근 메일 제목/요약)을 바탕으로 담당자가 취할 "다음 액션"을 한국어로 제안한다.
 *   · 존재 테이블/컬럼(brands, brand_emails)만 사용하고 데이터를 지어내지 않는다.
 *   · 등급 판정·발송 게이트·정산 금액 산정 같은 판정은 하지 말고, 제안·문구·요약만 작성.
 *   · 개인정보(카드번호·신분증·비밀번호)는 프롬프트/출력에 포함하지 않는다.
 */
export async function suggestNextActionsAction(
  brandId: string,
): Promise<NextActionSuggestResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brandId)) {
    return { ok: false, error: "잘못된 브랜드 ID" };
  }

  // 실데이터 — 브랜드 맥락(개인정보 컬럼은 조회하지 않음).
  const brand = await queryOne<{
    brand_name: string;
    category: string;
    state: State;
    next_action: string;
    brief_md: string | null;
    due_date: string | null;
    last_contact_at: string | null;
  }>(
    `SELECT brand_name, category, state, next_action, brief_md, due_date, last_contact_at
       FROM brands WHERE id=$1`,
    [brandId],
  ).catch(() => null);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없습니다." };

  // 최근 메일 — 방향·제목·요약만(주소 등 개인정보는 프롬프트에 넣지 않음).
  const emails = await query<{
    direction: string;
    subject: string | null;
    snippet: string | null;
    occurred_at: string;
  }>(
    `SELECT direction, subject, snippet, occurred_at
       FROM brand_emails WHERE brand_id=$1 ORDER BY occurred_at DESC LIMIT 5`,
    [brandId],
  ).catch(() => [] as { direction: string; subject: string | null; snippet: string | null; occurred_at: string }[]);

  const DIR_LABEL: Record<string, string> = { in: "수신", out: "발신", unknown: "-" };
  const mailLines = emails.length
    ? emails
        .map(
          (e) =>
            `- ${e.occurred_at.slice(0, 10)} ${DIR_LABEL[e.direction] ?? e.direction} · ${e.subject || "(제목 없음)"}${e.snippet ? ` — ${e.snippet.slice(0, 120)}` : ""}`,
        )
        .join("\n")
    : "- 기록된 메일 없음";

  const briefText = brand.brief_md
    ? brand.brief_md.slice(0, 1500)
    : "(사전분석 브리프 미생성)";

  const system = `너는 GloveK(틱톡샵 해외진출 운영대행사)의 브랜드 담당 매니저를 돕는 AI 도우미다. 아래 브랜드 맥락을 바탕으로, 담당자가 지금 취하면 좋은 한국어 "다음 액션 제안"을 작성한다.
규칙:
- 제공된 맥락만 사용하고 없는 사실을 지어내지 않는다.
- 등급 판정·발송 게이트 충족 여부·정산 금액 산정 같은 판정은 하지 말고, 실무적인 다음 액션 제안·문구·요약만 작성한다.
- 개인정보(카드번호·신분증·비밀번호)는 절대 포함하지 않는다.
- 형식: 우선순위가 높은 순서로 3~5개의 구체적 액션을 번호 목록으로. 각 항목은 한 줄로 간결하게(무엇을·왜). 마지막에 한 줄 코멘트.`;

  const user = `브랜드: ${brand.brand_name}
카테고리: ${brand.category || "미상"}
현재 단계: ${STATE_LABELS[brand.state] ?? brand.state}
기존 다음 액션: ${brand.next_action || "(없음)"}${brand.due_date ? ` (기한 ${brand.due_date.slice(0, 10)})` : ""}
마지막 접촉: ${brand.last_contact_at ? brand.last_contact_at.slice(0, 10) : "기록 없음"}

사전분석 브리프:
${briefText}

최근 메일:
${mailLines}

위 맥락으로 담당자를 위한 "다음 액션 제안"을 작성해줘.`;

  const draft = await aiText({ system, user, maxTokens: 700 }).catch(() => null);
  if (!draft) return { ok: false, error: "AI 제안 생성 실패 (잠시 후 재시도)" };
  return { ok: true, draft: draft.trim() };
}
