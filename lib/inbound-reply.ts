// 인바운드 자동 회신 초안 (13) — 고객 메일 수신 → AI 요약 + 우리 데이터 근거 회신 초안.
//   원칙: 에이전트는 "초안"까지만. 발송은 담당자 승인(초안함) 후.
//   근거: 브랜드 카드·이전 메일 스레드·미팅 회의록·서류/결제 상태·승인 QnA.
//   개인정보(카드·신분증·비밀번호)는 프롬프트/출력 금지. kind=reply_transactional(거래성 화이트리스트).
import { query, queryOne } from "./db";
import { aiText, aiEnabled } from "./ai";
import type { Brand } from "./types";

export interface PendingInbound {
  id: string; brand_id: string; brand_name: string;
  thread_id: string; from_addr: string; subject: string;
  snippet: string; body_text: string | null; sent_at: string;
}

/**
 * 회신 필요한 수신 메일: reply_state='none' 이고, 같은 스레드에 이 메일보다 나중의
 * 아웃바운드(우리 발송)가 없는 것 = 아직 답장 안 한 고객 메일. 최신순.
 */
export function pendingInbound(limit = 10): Promise<PendingInbound[]> {
  return query<PendingInbound>(
    `SELECT m.id, m.brand_id, b.brand_name, m.thread_id, m.from_addr,
            m.subject, m.snippet, m.body_text, m.sent_at
       FROM email_messages m JOIN brands b ON b.id=m.brand_id
      WHERE m.direction='in' AND m.reply_state='none'
        AND NOT EXISTS (
          SELECT 1 FROM email_messages o
           WHERE o.thread_id=m.thread_id AND o.direction='out' AND o.sent_at >= m.sent_at)
      ORDER BY m.sent_at DESC LIMIT $1`, [limit]);
}

/** 한 통의 브랜드 컨텍스트 수집(회신 근거). 방어적. */
async function gatherContext(brandId: string) {
  const brand = await queryOne<Brand>("SELECT * FROM brands WHERE id=$1", [brandId]);
  const thread = await query<{ direction: string; subject: string; snippet: string; sent_at: string }>(
    "SELECT direction, subject, snippet, sent_at FROM email_messages WHERE brand_id=$1 ORDER BY sent_at DESC LIMIT 6",
    [brandId]).catch(() => []);
  const meeting = await queryOne<{ summary_md: string }>(
    "SELECT summary_md FROM meetings WHERE brand_id=$1 AND summary_md IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [brandId]).catch(() => null);
  const docs = await query<{ label: string; done: boolean }>(
    "SELECT label, done FROM doc_items WHERE brand_id=$1 ORDER BY done, label LIMIT 12",
    [brandId]).catch(() => []);
  const qna = await query<{ question: string; answer: string }>(
    "SELECT question, answer FROM qna_entries WHERE approved=true ORDER BY usage_count DESC LIMIT 5",
    []).catch(() => []);
  return { brand, thread, meeting, docs, qna };
}

export interface DraftReplyResult { ok: boolean; draftId?: string; error?: string; ai: boolean }

/**
 * 수신 메일 1통에 대한 요약 + 회신 초안 생성 → email_drafts(draft) 저장, 원본 reply_state='drafted'.
 *   AI 키 없으면: 요약=snippet, 회신=수동작성 스켈레톤(담당자가 초안함에서 작성).
 */
export async function draftReplyForMessage(msgId: string): Promise<DraftReplyResult> {
  const msg = await queryOne<PendingInbound & { direction: string; owner_email: string | null }>(
    `SELECT m.*, b.brand_name FROM email_messages m JOIN brands b ON b.id=m.brand_id WHERE m.id=$1`, [msgId]);
  if (!msg) return { ok: false, error: "메일 없음", ai: false };
  if (msg.direction !== "in") return { ok: false, error: "수신 메일 아님", ai: false };

  const { brand, thread, meeting, docs, qna } = await gatherContext(msg.brand_id);
  const inboundText = (msg.body_text || msg.snippet || "").slice(0, 6000);

  const ctx = [
    `브랜드: ${brand?.brand_name ?? msg.brand_name} (${brand?.category ?? "-"})`,
    `담당자: ${brand?.contact_name || "-"} <${brand?.email || msg.from_addr}>`,
    `현재 단계: ${brand?.state ?? "-"} · 플랜: ${brand?.plan ?? "미정"} · 목표국: ${(brand?.countries ?? []).join(",") || "미정"}`,
    `다음 액션(내부): ${brand?.next_action || "-"}`,
    docs.length ? `\n[서류 현황] ${docs.map((d) => `${d.label}:${d.done ? "완료" : "미완"}`).join(", ")}` : "",
    meeting?.summary_md ? `\n[최근 미팅 회의록]\n${meeting.summary_md.slice(0, 1500)}` : "",
    thread.length ? `\n[최근 메일 스레드(신→구)]\n${thread.map((t) => `- (${t.direction}) ${t.subject}: ${t.snippet}`).join("\n")}` : "",
    qna.length ? `\n[참고 QnA]\n${qna.map((q) => `Q:${q.question}\nA:${q.answer}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  let summary = (msg.snippet || "").slice(0, 300);
  let subject = msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject || brand?.brand_name || ""}`.trim();
  let body = `(수동 작성 필요 — ANTHROPIC_API_KEY 미설정)\n\n원문 요약: ${summary}\n\n담당자님, 위 고객 문의에 대한 회신을 작성해 주세요.`;
  let usedAi = false;

  if (aiEnabled()) {
    // ① 인바운드 요약
    const sum = await aiText({
      system: "너는 GloveK(틱톡샵 해외진출 대행사) 운영 담당자다. 고객이 보낸 메일을 3줄 이내로 요약하고, 고객이 원하는 액션·질문을 명확히 뽑아라. 개인정보(카드·신분증·비밀번호)는 요약에 포함하지 마라.",
      user: `아래는 고객이 보낸 메일이다. 핵심 요약과 우리가 응답해야 할 포인트를 정리해줘.\n\n제목: ${msg.subject}\n보낸이: ${msg.from_addr}\n본문:\n${inboundText}`,
      maxTokens: 400,
    }).catch(() => null);
    if (sum) summary = sum;

    // ② 근거기반 회신 초안 (우리 데이터 컨텍스트 주입)
    const reply = await aiText({
      system: `너는 GloveK 담당자로서 고객 메일에 대한 정중한 비즈니스 한국어 회신 초안을 쓴다.
규칙:
- 반드시 아래 [우리 데이터]에 근거해 사실만 답한다. 모르는 것은 "확인 후 회신" 으로 남기고 지어내지 않는다.
- 고객이 물은 것에 먼저 답하고, 다음 스텝(서류·미팅·결제 등)을 명확히 제시한다.
- 개인정보(카드·신분증·비밀번호)는 절대 요청/기재하지 않는다. 과장 금지.
- 첫 줄에 "제목: ..." 한 줄, 빈 줄, 이후 본문만 출력한다.
- 초안일 뿐이며 담당자가 검토·발송한다.`,
      user: `[고객이 보낸 메일]\n제목: ${msg.subject}\n본문:\n${inboundText}\n\n[우리 데이터]\n${ctx}\n\n위 고객 메일에 대한 회신 초안을 작성해줘.`,
      maxTokens: 1200,
    }).catch(() => null);
    if (reply) {
      const m = reply.match(/^제목:\s*(.+)$/m);
      if (m) subject = m[1].trim();
      body = reply.replace(/^제목:\s*.+$/m, "").trim();
      usedAi = true;
    }
  }

  // 저장 — 초안함(draft) + 원본 연결 + 인바운드 요약(담당 검토용).
  //   from_mailbox = 고객이 보낸 그 공용 메일함 → 회신도 같은 메일함 명의로 발송/임시저장.
  const row = await queryOne<{ id: string }>(
    `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status, in_reply_to, context_summary, source, from_mailbox)
     VALUES ($1,'reply_transactional',$2,$3,$4,'draft',$5,$6,'inbound_agent',$7) RETURNING id`,
    [msg.brand_id, brand?.email || msg.from_addr, subject, body, msg.id, summary, msg.owner_email ?? null]).catch(() => null);
  if (!row) return { ok: false, error: "초안 저장 실패", ai: usedAi };

  await query("UPDATE email_messages SET reply_state='drafted', ai_summary=$2 WHERE id=$1", [msg.id, summary]).catch(() => {});
  return { ok: true, draftId: row.id, ai: usedAi };
}

/** 회신 대기 수신 메일 일괄 처리 → 초안 생성 건수. (에이전트/크론에서 호출) */
export async function draftInboundReplies(limit = 10): Promise<{ pending: number; drafted: number; ai: boolean }> {
  const list = await pendingInbound(limit).catch(() => []);
  let drafted = 0;
  let ai = false;
  for (const m of list) {
    const r = await draftReplyForMessage(m.id).catch(() => null);
    if (r?.ok) { drafted++; if (r.ai) ai = true; }
  }
  return { pending: list.length, drafted, ai };
}
