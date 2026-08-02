// 고객데이터·대화맥락 기반 메일 초안 생성 (08/09) — 카드+스레드+미팅+QnA → AI 초안.
//   생성물은 email_drafts(초안함)로 → 사람 승인·발송(lib/drafts.ts, Resend).
import Anthropic from "@anthropic-ai/sdk";
import { query, queryOne } from "./db";
import { env } from "./env";
import type { Brand } from "./types";

import { AI_MODEL } from "./ai";
const MODEL = AI_MODEL;

export interface ComposeResult { ok: boolean; draftId?: string; subject?: string; body?: string; error?: string }

/**
 * 브랜드 카드·최근 메일 스레드·미팅 요약·QnA 를 맥락으로 메일 초안 생성 → email_drafts 저장.
 *   intent: 자유 지시(예: "제안 팔로업", "서류 재요청", "정산 안내"). 없으면 상황 자동 판단.
 */
export async function draftContextualEmail(brandId: string, intent?: string): Promise<ComposeResult> {
  const brand = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [brandId]);
  if (!brand) return { ok: false, error: "브랜드 없음" };
  if (!env.anthropicKey) return { ok: false, error: "ANTHROPIC_API_KEY 미설정" };

  // ── 맥락 수집 (모두 방어) ──
  const thread = await query<{ direction: string; from_addr: string; subject: string; snippet: string; sent_at: string }>(
    "SELECT direction, from_addr, subject, snippet, sent_at FROM email_messages WHERE brand_id=$1 ORDER BY sent_at DESC LIMIT 6",
    [brandId]).catch(() => []);
  const meeting = await queryOne<{ summary_md: string }>(
    "SELECT summary_md FROM meetings WHERE brand_id=$1 AND summary_md IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [brandId]).catch(() => null);
  const qna = await query<{ question: string; answer: string }>(
    "SELECT question, answer FROM qna_entries WHERE approved=true ORDER BY usage_count DESC LIMIT 5",
    []).catch(() => []);

  const contextLines = [
    `브랜드: ${brand.brand_name} (${brand.category})`,
    `담당자: ${brand.contact_name || "-"} <${brand.email || "-"}>`,
    `현재 단계: ${brand.state} · 플랜: ${brand.plan ?? "미정"} · 목표국: ${(brand.countries ?? []).join(",") || "미정"}`,
    `다음 액션(내부): ${brand.next_action || "-"}`,
    meeting?.summary_md ? `\n[최근 미팅 회의록]\n${meeting.summary_md}` : "",
    thread.length ? `\n[최근 메일 스레드(신→구)]\n${thread.map((t) => `- (${t.direction}) ${t.subject}: ${t.snippet}`).join("\n")}` : "",
    qna.length ? `\n[참고 QnA]\n${qna.map((q) => `Q:${q.question}\nA:${q.answer}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const client = new Anthropic({ apiKey: env.anthropicKey });
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1200,
    system: `너는 GloveK(틱톡샵 해외진출 대행사)의 담당자로서 고객에게 보낼 정중한 비즈니스 한국어 메일을 쓴다.
규칙: 맥락(회의록·이전 메일·단계)에 자연스럽게 이어지게, 다음 스텝을 명확히, 과장 금지.
개인정보(카드·신분증·비밀번호)는 절대 쓰지 않는다.
반드시 첫 줄에 "제목: ..." 한 줄, 그 다음 빈 줄, 이후 본문만 출력한다.`,
    messages: [{
      role: "user",
      content: `아래 고객 맥락을 바탕으로 ${intent ? `"${intent}"` : "현재 단계에 맞는 후속"} 메일 초안을 작성해줘.\n\n${contextLines}`,
    }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();

  // "제목: ..." 파싱
  const m = text.match(/^제목:\s*(.+)$/m);
  const subject = m ? m[1].trim() : `[GloveK] ${brand.brand_name} 안내`;
  const body = text.replace(/^제목:\s*.+$/m, "").trim();

  const kind = thread.some((t) => t.direction === "in") ? "reply" : "followup";
  const row = await queryOne<{ id: string }>(
    `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status)
     VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id`,
    [brandId, kind, brand.email ?? "", subject, body]);

  return { ok: true, draftId: row?.id, subject, body };
}
