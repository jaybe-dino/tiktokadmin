// 대량 발송 워커 — bulk_sends 큐(status='queued')를 실제로 소비해 발송한다.
//   기존엔 큐에 쌓이기만 하고 소비자가 없어 영구 미발송이었음(QA 마케팅#1~3).
//   경로: 크론(/api/cron/bulk-send) → processBulkSends() → 대상별 sendSms/sendEmail.
//   개인화: 템플릿의 {브랜드명}{담당자명}{설문링크} 치환(renderTemplate).
//   감사: bulk_send_targets.status/sent_at/error + bulk_sends.sent/failed/finished_at.
import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { sendEmail } from "./mailer";
import { sendSms } from "./sms";
import { renderTemplate } from "./templates";
import { env } from "./env";
import { SEGMENTS } from "./segments";

interface BulkSend { id: string; channel: "email" | "sms" | "both"; body_md: string; title: string; target_kind: string; target_def: { lead_group?: string; segment?: string } }
interface Target { brand_id: string; brand_name: string; contact_name: string | null; email: string | null; phone: string | null }

/** body_md 에서 "제목: ...\n\n본문" 분리(메일 제목). 없으면 subject="" . */
function splitSubject(bodyMd: string): { subject: string; body: string } {
  const m = bodyMd.match(/^제목:\s*(.+?)\n\n?([\s\S]*)$/);
  if (m) return { subject: m[1].trim(), body: m[2] };
  const m2 = bodyMd.match(/^제목:\s*(.+)$/m);
  if (m2) return { subject: m2[1].trim(), body: bodyMd.replace(/^제목:\s*.+$/m, "").trim() };
  return { subject: "", body: bodyMd };
}

/** {설문링크} 용 공개 설문 링크 — 미응답 설문 재사용 또는 신규 토큰 생성. */
async function surveyLinkFor(brandId: string): Promise<string> {
  const existing = await queryOne<{ token: string }>(
    "SELECT token FROM surveys WHERE brand_id=$1 AND responded_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [brandId]).catch(() => null);
  let token = existing?.token;
  if (!token) {
    token = randomBytes(9).toString("base64url");
    await query("INSERT INTO surveys (brand_id, kind, token, sent_at) VALUES ($1,'pre_meeting',$2,now())",
      [brandId, token]).catch(() => {});
  }
  return `${env.adminUrl}/s/${token}`;
}

// 채널별 연락처 보유 조건(고정 문자열 — 사용자 입력 아님).
function contactCond(channel: string): string {
  if (channel === "sms") return "b.phone IS NOT NULL AND b.phone <> ''";
  if (channel === "both") return "((b.email IS NOT NULL AND b.email <> '') OR (b.phone IS NOT NULL AND b.phone <> ''))";
  return "b.email IS NOT NULL AND b.email <> ''";
}
const CONSENT_COND = "EXISTS (SELECT 1 FROM brand_contacts c WHERE c.brand_id = b.id AND c.marketing_consent = true)";

/**
 * 대상 스냅샷 보장 — 세그먼트/필터 캠페인처럼 targets 가 비어 있으면 여기서 산정·삽입.
 *   동의(marketing_consent)+연락처 보유 대상만(게이트 준수). lead_group 은 이미 삽입돼 있으면 no-op.
 */
async function ensureTargets(s: BulkSend): Promise<void> {
  const has = await queryOne<{ n: string }>("SELECT count(*)::text n FROM bulk_send_targets WHERE bulk_id=$1", [s.id]).catch(() => null);
  if (Number(has?.n ?? 0) > 0) return;

  const cc = contactCond(s.channel);
  if (s.target_kind === "lead_group" && s.target_def?.lead_group) {
    await query(
      `INSERT INTO bulk_send_targets (bulk_id, brand_id, channel, status)
       SELECT $1, b.id, $2, 'pending' FROM brands b
        WHERE b.lead_group = $3 AND (${cc}) AND (${CONSENT_COND})
       ON CONFLICT (bulk_id, brand_id) DO NOTHING`,
      [s.id, s.channel, s.target_def.lead_group]).catch(() => {});
  } else if (s.target_kind === "filter" && s.target_def?.segment && SEGMENTS[s.target_def.segment]) {
    const seg = SEGMENTS[s.target_def.segment];
    await query(
      `INSERT INTO bulk_send_targets (bulk_id, brand_id, channel, status)
       SELECT $1, b.id, $2, 'pending' FROM brands b
        WHERE coalesce(b.is_test,false)=false AND (${seg.where}) AND (${cc}) AND (${CONSENT_COND})
       ON CONFLICT (bulk_id, brand_id) DO NOTHING`,
      [s.id, s.channel]).catch(() => {});
  }
}

export interface BulkSendRunResult { picked: number; sent: number; failed: number; done: number }

/**
 * queued/sending 상태의 대량 발송을 픽업해 대상별로 실제 발송.
 *   maxSends: 한 런에서 처리할 발송 건수 · maxPerSend: 발송당 대상 상한(레이트/시간 보호).
 */
export async function processBulkSends(opt?: { maxSends?: number; maxPerSend?: number }): Promise<BulkSendRunResult> {
  const maxSends = opt?.maxSends ?? 5;
  const maxPer = opt?.maxPerSend ?? 300;

  const sends = await query<BulkSend>(
    "SELECT id, channel, body_md, title, target_kind, target_def FROM bulk_sends WHERE status IN ('queued','sending') ORDER BY created_at LIMIT $1",
    [maxSends]).catch(() => []);

  let sent = 0, failed = 0, done = 0;

  for (const s of sends) {
    await query("UPDATE bulk_sends SET status='sending', started_at=coalesce(started_at, now()) WHERE id=$1", [s.id]).catch(() => {});
    await ensureTargets(s);
    const { subject, body } = splitSubject(s.body_md);
    const needSurvey = s.body_md.includes("{설문링크}");

    const targets = await query<Target>(
      `SELECT t.brand_id, b.brand_name, b.contact_name, b.email, b.phone
         FROM bulk_send_targets t JOIN brands b ON b.id = t.brand_id
        WHERE t.bulk_id = $1 AND t.status = 'pending'
        ORDER BY b.brand_name LIMIT $2`,
      [s.id, maxPer]).catch(() => []);

    for (const t of targets) {
      const vars: Record<string, string> = { "브랜드명": t.brand_name, "담당자명": t.contact_name || t.brand_name };
      if (needSurvey) vars["설문링크"] = await surveyLinkFor(t.brand_id);

      let ok = false, err = "";
      try {
        if ((s.channel === "sms" || s.channel === "both") && t.phone) {
          const r = await sendSms({ receiver: t.phone, msg: renderTemplate(body, vars), title: subject || undefined });
          if (r.ok) ok = true; else err = r.message || "SMS 실패";
        }
        if ((s.channel === "email" || s.channel === "both") && t.email) {
          const subj = renderTemplate(subject || `[GloveK] ${t.brand_name}님 안내`, vars);
          const r = await sendEmail({ to: t.email, subject: subj, text: renderTemplate(body, vars) });
          if (r.ok) ok = true; else err = r.skipped ? "메일 발송 미설정(Gmail/RESEND)" : (r.error || "메일 실패");
        }
        if (s.channel === "sms" && !t.phone) err = "전화번호 없음";
        if (s.channel === "email" && !t.email) err = "이메일 없음";
      } catch (e) { err = (e as Error).message; }

      if (ok) {
        await query("UPDATE bulk_send_targets SET status='sent', sent_at=now(), attempts=attempts+1, error=NULL WHERE bulk_id=$1 AND brand_id=$2", [s.id, t.brand_id]).catch(() => {});
        sent++;
      } else {
        await query("UPDATE bulk_send_targets SET status='failed', attempts=attempts+1, error=$3 WHERE bulk_id=$1 AND brand_id=$2", [s.id, t.brand_id, err.slice(0, 300)]).catch(() => {});
        failed++;
      }
    }

    // 집계·마무리 — 남은 pending 이 없으면 done.
    const agg = await queryOne<{ pend: string; sent: string; failed: string }>(
      `SELECT count(*) FILTER (WHERE status='pending')::text pend,
              count(*) FILTER (WHERE status='sent')::text sent,
              count(*) FILTER (WHERE status='failed')::text failed
         FROM bulk_send_targets WHERE bulk_id=$1`, [s.id]).catch(() => null);
    const allDone = Number(agg?.pend ?? 0) === 0;
    await query(
      "UPDATE bulk_sends SET sent=$2, failed=$3, status=$4, finished_at=$5 WHERE id=$1",
      [s.id, Number(agg?.sent ?? 0), Number(agg?.failed ?? 0), allDone ? "done" : "sending", allDone ? new Date().toISOString() : null]).catch(() => {});
    if (allDone) done++;
  }

  return { picked: sends.length, sent, failed, done };
}
