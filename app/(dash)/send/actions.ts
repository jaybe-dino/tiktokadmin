"use server";

// 발송 센터 전용 서버액션 (이 화면에서만 사용).
//   @/app/actions.ts 는 수정 금지 → 신규 버튼용 액션은 여기서 정의.
//   실제 발송·수신동의는 기존 게이트/라이브러리 재사용:
//     · AI 초안: lib/ai(aiText)   · 개별 메일 초안: @/app/actions(composeEmailAction)
//     · 개별 문자: @/app/actions(sendSmsAction)  · 자가 테스트 메일: lib/mailer(sendEmail)
//     · 대량 발송: bulk_sends 큐 등록 + 수신동의 보유 대상만 bulk_send_targets 로 산정(동의 게이트 준수).

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { aiText, aiEnabled } from "@/lib/ai";

export interface SendResult {
  ok: boolean;
  error?: string;
}

type Channel = "email" | "sms" | "both";

/* ── AI 초안 생성 (대량 메일·문자 공용) ─────────────────────────── */
export async function draftBulkCopyAction(input: {
  channel: "email" | "sms";
  template?: string;
  intent?: string;
}): Promise<SendResult & { subject?: string; body?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!aiEnabled()) return { ok: false, error: "ANTHROPIC_API_KEY 미설정 — AI 초안 생성 불가" };

  const isSms = input.channel === "sms";
  const topic = (input.template || "").trim() || (input.intent || "").trim() || "박람회/세미나 후속 안내";
  const system = isSms
    ? `너는 GloveK(틱톡샵 해외진출 대행사)의 담당자다. 고객에게 보낼 짧은 한국어 알림톡/SMS 문안을 쓴다.
규칙: 90바이트 내외로 간결하게, 개인화 변수 {브랜드명}{담당자명} 활용, 과장·개인정보 금지. 본문만 출력.`
    : `너는 GloveK(틱톡샵 해외진출 대행사)의 담당자다. 고객에게 보낼 정중한 비즈니스 한국어 메일을 쓴다.
규칙: 개인화 변수 {브랜드명}{담당자명}{담당자예약링크} 활용, 다음 스텝을 명확히, 과장·개인정보 금지.
반드시 첫 줄에 "제목: ..." 한 줄, 그 다음 빈 줄, 이후 본문만 출력한다.`;

  const text = await aiText({
    system,
    user: `아래 주제로 대량 발송용 ${isSms ? "문자" : "메일"} 초안을 작성해줘: "${topic}"`,
    maxTokens: isSms ? 400 : 900,
  }).catch(() => null);

  if (!text) return { ok: false, error: "AI 초안 생성 실패 (잠시 후 재시도)" };

  if (isSms) return { ok: true, body: text.trim() };

  const m = text.match(/^제목:\s*(.+)$/m);
  const subject = m ? m[1].trim() : `[GloveK] ${topic}`;
  const body = text.replace(/^제목:\s*.+$/m, "").trim();
  return { ok: true, subject, body };
}

/* ── 테스트 발송 (나에게) — 로그인 계정 이메일로 실발송 ───────────── */
export async function sendTestToSelfAction(input: {
  subject?: string;
  body: string;
}): Promise<SendResult & { info?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.body?.trim()) return { ok: false, error: "본문을 먼저 작성하세요." };
  const to = u.id; // 세션 계정 = 이메일
  if (!to.includes("@")) return { ok: false, error: "내 계정 이메일을 확인할 수 없습니다." };

  const { sendEmail } = await import("@/lib/mailer");
  const r = await sendEmail({
    to,
    subject: `[테스트] ${input.subject?.trim() || "대량 메일 미리보기"}`,
    text: input.body,
  });
  if (r.ok) return { ok: true, info: `테스트 메일 발송 완료 → ${to}` };
  if (r.skipped) return { ok: false, error: "RESEND_API_KEY 미설정 — 실제 발송 비활성" };
  return { ok: false, error: r.error || "발송 실패" };
}

/* ── 대량 발송 실행 — 수신동의 보유 대상만 산정해 bulk_sends 큐 등록 ── */
export async function createBulkSendAction(input: {
  channel: Channel;
  leadGroup: string;
  title?: string;
  subject?: string;
  body: string;
}): Promise<SendResult & { total?: number; excludedOptout?: number; excludedNoContact?: number; id?: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!input.leadGroup?.trim()) return { ok: false, error: "대상 리드 그룹을 선택하세요." };
  if (!input.body?.trim()) return { ok: false, error: "발송 본문을 작성하세요." };

  // 채널별 연락처 보유 조건(고정 문자열 — 사용자 입력 아님).
  const contactCond =
    input.channel === "sms"
      ? "b.phone IS NOT NULL AND b.phone <> ''"
      : input.channel === "both"
        ? "((b.email IS NOT NULL AND b.email <> '') OR (b.phone IS NOT NULL AND b.phone <> ''))"
        : "b.email IS NOT NULL AND b.email <> ''";

  const consentCond =
    "EXISTS (SELECT 1 FROM brand_contacts c WHERE c.brand_id = b.id AND c.marketing_consent = true)";

  // 대상 집계: 동의+연락처 보유(eligible) / 연락처 없음 / 동의 없음.
  const agg = await queryOne<{ eligible: number; no_contact: number; optout: number }>(
    `SELECT
       count(*) FILTER (WHERE has_contact AND has_consent)::int      AS eligible,
       count(*) FILTER (WHERE NOT has_contact)::int                  AS no_contact,
       count(*) FILTER (WHERE has_contact AND NOT has_consent)::int  AS optout
     FROM (
       SELECT (${contactCond}) AS has_contact, (${consentCond}) AS has_consent
         FROM brands b
        WHERE b.lead_group = $1
     ) t`,
    [input.leadGroup],
  ).catch(() => null);

  if (!agg) return { ok: false, error: "대상 집계 실패" };
  if ((agg.eligible ?? 0) === 0) {
    return {
      ok: false,
      error: `발송 가능 대상 0명 (연락처 없음 ${agg.no_contact ?? 0} · 미동의 ${agg.optout ?? 0})`,
    };
  }

  const title = input.title?.trim() || `${input.leadGroup} · 대량 ${input.channel === "sms" ? "문자" : "메일"}`;
  const bodyMd = input.subject?.trim() ? `제목: ${input.subject.trim()}\n\n${input.body}` : input.body;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO bulk_sends
       (title, target_kind, target_def, channel, body_md, status,
        total, sent, excluded_optout, excluded_nocontact, created_by)
     VALUES ($1,'lead_group',$2::jsonb,$3,$4,'queued',$5,0,$6,$7,$8)
     RETURNING id`,
    [
      title,
      JSON.stringify({ lead_group: input.leadGroup }),
      input.channel,
      bodyMd,
      agg.eligible,
      agg.optout ?? 0,
      agg.no_contact ?? 0,
      u.id,
    ],
  );

  if (!row) return { ok: false, error: "발송 등록 실패" };

  // 수신동의 보유 대상만 큐에 적재(동의 없는 대상은 제외 — 게이트 준수).
  await query(
    `INSERT INTO bulk_send_targets (bulk_id, brand_id, channel, status)
     SELECT $1, b.id, $2, 'pending'
       FROM brands b
      WHERE b.lead_group = $3 AND (${contactCond}) AND (${consentCond})
     ON CONFLICT (bulk_id, brand_id) DO NOTHING`,
    [row.id, input.channel, input.leadGroup],
  ).catch(() => {});

  revalidatePath("/send");
  return {
    ok: true,
    id: row.id,
    total: agg.eligible,
    excludedOptout: agg.optout ?? 0,
    excludedNoContact: agg.no_contact ?? 0,
  };
}
