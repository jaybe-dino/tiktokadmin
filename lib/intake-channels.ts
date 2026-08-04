// 유입 채널(주제별 키) — Zapier/외부 DB 가 채널 키로 POST 하면 채널별 문자·메일 내용/토글 적용.
//   /api/leadhook?key=<채널키> → resolveChannel → ingest(source) → sendChannelWelcome(토글·템플릿).
import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { sendSms } from "./sms";
import { sendEmail } from "./mailer";
// 공용 렌더러 — vars 에 있는 모든 {키} 치환(브랜드명·담당자명·설문링크 등).
import { renderTemplate as render } from "./templates";

export interface IntakeChannel {
  id: string; key: string; name: string; source: string;
  enabled: boolean; send_sms: boolean; send_email: boolean; test_mode: boolean;
  sms_template: string; email_subject: string; email_body: string;
  note: string; lead_count: number; last_lead_at: string | null;
  created_by: string | null; created_at: string;
}

const maskContact = (s: string | null): string => {
  if (!s) return "";
  if (s.includes("@")) { const [a, b] = s.split("@"); return `${a.slice(0, 2)}***@${b}`; }
  return s.length > 4 ? `${s.slice(0, 3)}***${s.slice(-2)}` : "***";
};

export function listChannels(): Promise<IntakeChannel[]> {
  return query<IntakeChannel>("SELECT * FROM intake_channels ORDER BY created_at DESC").catch(() => []);
}

/** 키로 채널 조회(정확 일치). 없으면 null. */
export function resolveChannel(key: string): Promise<IntakeChannel | null> {
  return queryOne<IntakeChannel>("SELECT * FROM intake_channels WHERE key=$1", [key]).catch(() => null);
}

/** 랜덤 채널 키 생성 (URL-safe, 24자). */
function genKey(): string {
  const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const buf = randomBytes(24);  // crypto 랜덤 — 예측 불가 키.
  let s = "";
  for (const b of buf) s += abc[b % abc.length];
  return s;
}

export async function createChannel(input: {
  name: string; source: string; note?: string; createdBy: string;
  sms_template?: string; email_subject?: string; email_body?: string;
}): Promise<IntakeChannel | null> {
  const key = genKey();
  return queryOne<IntakeChannel>(
    `INSERT INTO intake_channels (key, name, source, note, sms_template, email_subject, email_body, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [key, input.name.trim(), input.source, input.note ?? "",
     input.sms_template ?? "", input.email_subject ?? "", input.email_body ?? "", input.createdBy])
    .catch(() => null);  // 테이블 미생성(마이그 0027 미적용) 등 → null → 액션이 안내 반환
}

export async function updateChannel(id: string, patch: Partial<IntakeChannel>): Promise<void> {
  await query(
    `UPDATE intake_channels SET
       name=COALESCE($2,name), source=COALESCE($3,source), enabled=COALESCE($4,enabled),
       send_sms=COALESCE($5,send_sms), send_email=COALESCE($6,send_email),
       sms_template=COALESCE($7,sms_template), email_subject=COALESCE($8,email_subject),
       email_body=COALESCE($9,email_body), note=COALESCE($10,note), test_mode=COALESCE($11,test_mode)
     WHERE id=$1`,
    [id, patch.name ?? null, patch.source ?? null, patch.enabled ?? null,
     patch.send_sms ?? null, patch.send_email ?? null, patch.sms_template ?? null,
     patch.email_subject ?? null, patch.email_body ?? null, patch.note ?? null, patch.test_mode ?? null]);
}

export async function deleteChannel(id: string): Promise<void> {
  await query("DELETE FROM intake_channels WHERE id=$1", [id]);
}

/** 채널 유입 통계 갱신 (리드 인입 시). */
export async function recordChannelLead(id: string): Promise<void> {
  await query("UPDATE intake_channels SET lead_count=lead_count+1, last_lead_at=now() WHERE id=$1", [id]).catch(() => {});
}

export interface ChannelSend {
  id: string; channel_id: string; brand_id: string | null; brand_name: string;
  sms_sent: boolean; email_sent: boolean; dry_run: boolean;
  to_masked: string | null; sms_body: string | null; email_subject: string | null; email_body: string | null;
  error: string | null; sent_at: string;
}

/** 소스별 자동발송 이력 기록 — 실제 발송 내용 스냅샷 포함(오발송 감사). 수신처 마스킹. */
export async function recordChannelSend(channelId: string, brandId: string, brandName: string, r: {
  smsSent: boolean; emailSent: boolean; dryRun: boolean;
  to?: string | null; smsBody?: string; emailSubject?: string; emailBody?: string; error?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO channel_sends (channel_id, brand_id, brand_name, sms_sent, email_sent, dry_run, to_masked, sms_body, email_subject, email_body, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [channelId, brandId, brandName, r.smsSent, r.emailSent, r.dryRun, maskContact(r.to ?? null),
     r.smsBody ?? null, r.emailSubject ?? null, r.emailBody ?? null, r.error ?? null]).catch(() => {});
}

/** 여러 채널의 최근 발송 이력 (채널 카드용). */
export async function recentChannelSends(channelIds: string[], perChannel = 8): Promise<Record<string, ChannelSend[]>> {
  if (channelIds.length === 0) return {};
  const rows = await query<ChannelSend & { rn: number }>(
    `SELECT * FROM (
       SELECT *, row_number() OVER (PARTITION BY channel_id ORDER BY sent_at DESC) rn
         FROM channel_sends WHERE channel_id = ANY($1)
     ) t WHERE rn <= $2`, [channelIds, perChannel]).catch(() => []);
  const map: Record<string, ChannelSend[]> = {};
  for (const r of rows) (map[r.channel_id] ??= []).push(r);
  return map;
}

/** 소스별 발송 건수(문자·메일). */
export async function channelSendCounts(channelIds: string[]): Promise<Record<string, { sms: number; email: number }>> {
  if (channelIds.length === 0) return {};
  const rows = await query<{ channel_id: string; sms: string; email: string }>(
    `SELECT channel_id, count(*) FILTER (WHERE sms_sent) sms, count(*) FILTER (WHERE email_sent) email
       FROM channel_sends WHERE channel_id = ANY($1) GROUP BY channel_id`, [channelIds]).catch(() => []);
  const map: Record<string, { sms: number; email: number }> = {};
  for (const r of rows) map[r.channel_id] = { sms: Number(r.sms), email: Number(r.email) };
  return map;
}


/**
 * 채널별 자동 안내 발송 — 유입 즉시 1회(멱등: welcome_sent_at 공유).
 *   channel.enabled(자동발송 허용 체크)=false 면 스킵(유입은 이미 됨).
 *   문구는 채널 템플릿 우선, 비어 있으면 **전역 자동안내 문구**(신규 리드 자동 안내)로 폴백.
 *   → 키(유입 루트 허용)와 문구(공용)를 분리 관리.
 */
export async function sendChannelWelcome(brandId: string, channel: IntakeChannel): Promise<string[]> {
  if (!channel.enabled) return [];
  const b = await queryOne<{ brand_name: string; contact_name: string | null; email: string | null; phone: string | null; welcome_sent_at: string | null }>(
    "SELECT brand_name, contact_name, email, phone, welcome_sent_at FROM brands WHERE id=$1", [brandId]);
  if (!b || b.welcome_sent_at) return [];  // 이미 안내 발송됨(1회)

  // 전역 자동안내 문구(폴백) — 채널이 자체 문구를 안 가지면 이걸 사용.
  const { getWelcomeConfig } = await import("./welcome");
  const g = await getWelcomeConfig().catch(() => null);
  const smsTpl = channel.sms_template.trim() || (g?.sms_template ?? "").trim();
  const emailSubj = channel.email_subject.trim() || (g?.email_subject ?? "").trim();
  const emailBody = channel.email_body.trim() || (g?.email_body ?? "").trim();

  const vars = { "브랜드명": b.brand_name, "담당자명": b.contact_name || b.brand_name };
  const sent: string[] = [];

  // 발송될 실제 내용(렌더링) — 감사·미리보기용 스냅샷.
  const smsBody = channel.send_sms && smsTpl ? render(smsTpl, vars) : "";
  const emSubject = channel.send_email && (emailSubj || emailBody) ? render(emailSubj || `[GloveK] ${b.brand_name}님 안내`, vars) : "";
  const emBody = channel.send_email && (emailSubj || emailBody) ? render(emailBody, vars) : "";
  const dry = channel.test_mode;  // 테스트 모드 — 실발송 없이 내용만 기록.

  // 시도 여부(대상 연락처 + 토글 + 문구 존재)와 결과·사유를 분리 추적 → 실패도 이력에 남긴다.
  const smsAttempted = channel.send_sms && !!b.phone && !!smsBody;
  const emailAttempted = channel.send_email && !!b.email && !!(emSubject || emBody);
  let smsErr = "", emailErr = "";

  if (smsAttempted) {
    if (dry) { sent.push("sms"); }
    else {
      const r = await sendSms({ receiver: b.phone!, msg: smsBody }).catch((e) => ({ ok: false, message: (e as Error).message } as { ok: boolean; message?: string }));
      if (r.ok) sent.push("sms");
      else smsErr = r.message || "문자 발송 미설정/실패";
    }
  }
  if (emailAttempted) {
    if (dry) { sent.push("email"); }
    else {
      const r = await sendEmail({ to: b.email!, subject: emSubject, text: emBody });
      if (r.ok) sent.push("email");
      else emailErr = r.skipped ? "메일 발송 미설정(Gmail/RESEND)" : (r.error || "메일 발송 실패");
    }
  }

  // 실발송(테스트 아님)일 때만 브랜드 발송 상태 갱신. 테스트는 재발송 가능하게 미표시.
  if (sent.length && !dry) {
    await query("UPDATE brands SET welcome_sent_at=now(), welcome_channels=$2, last_contact_at=now() WHERE id=$1", [brandId, sent]);
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'admin','contact_logged',$2,now())`,
      [brandId, JSON.stringify({ channel: sent.join("+"), kind: "welcome", intake: channel.name })]).catch(() => {});
  }
  // 발송 히스토리 — 시도가 있었으면 성공/실패 무관 항상 기록(내용 스냅샷 + 실패 사유).
  //   기존엔 성공 시에만 기록 → provider 미설정이면 "유입 N건 · 발송 0" 만 보이고 이유가 없었음.
  if (smsAttempted || emailAttempted) {
    const error = [smsErr && `문자: ${smsErr}`, emailErr && `메일: ${emailErr}`].filter(Boolean).join(" · ") || null;
    await recordChannelSend(channel.id, brandId, b.brand_name, {
      smsSent: sent.includes("sms"), emailSent: sent.includes("email"), dryRun: dry,
      to: b.email || b.phone, smsBody, emailSubject: emSubject, emailBody: emBody, error,
    });
  }
  return sent;
}
