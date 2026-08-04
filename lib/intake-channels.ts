// 유입 채널(주제별 키) — Zapier/외부 DB 가 채널 키로 POST 하면 채널별 문자·메일 내용/토글 적용.
//   /api/leadhook?key=<채널키> → resolveChannel → ingest(source) → sendChannelWelcome(토글·템플릿).
import { query, queryOne } from "./db";
import { sendSms } from "./sms";
import { sendEmail } from "./mailer";

export interface IntakeChannel {
  id: string; key: string; name: string; source: string;
  enabled: boolean; send_sms: boolean; send_email: boolean;
  sms_template: string; email_subject: string; email_body: string;
  note: string; lead_count: number; last_lead_at: string | null;
  created_by: string | null; created_at: string;
}

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
  // crypto 랜덤 — 예측 불가 키.
  const buf = require("node:crypto").randomBytes(24) as Buffer;
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
     input.sms_template ?? "", input.email_subject ?? "", input.email_body ?? "", input.createdBy]);
}

export async function updateChannel(id: string, patch: Partial<IntakeChannel>): Promise<void> {
  await query(
    `UPDATE intake_channels SET
       name=COALESCE($2,name), source=COALESCE($3,source), enabled=COALESCE($4,enabled),
       send_sms=COALESCE($5,send_sms), send_email=COALESCE($6,send_email),
       sms_template=COALESCE($7,sms_template), email_subject=COALESCE($8,email_subject),
       email_body=COALESCE($9,email_body), note=COALESCE($10,note)
     WHERE id=$1`,
    [id, patch.name ?? null, patch.source ?? null, patch.enabled ?? null,
     patch.send_sms ?? null, patch.send_email ?? null, patch.sms_template ?? null,
     patch.email_subject ?? null, patch.email_body ?? null, patch.note ?? null]);
}

export async function deleteChannel(id: string): Promise<void> {
  await query("DELETE FROM intake_channels WHERE id=$1", [id]);
}

/** 채널 유입 통계 갱신 (리드 인입 시). */
export async function recordChannelLead(id: string): Promise<void> {
  await query("UPDATE intake_channels SET lead_count=lead_count+1, last_lead_at=now() WHERE id=$1", [id]).catch(() => {});
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(브랜드명|담당자명)\}/g, (_, k) => vars[k] ?? "").replace(/\\n/g, "\n");
}

/**
 * 채널별 자동 안내 발송 — 채널 토글·템플릿 사용. 유입 즉시 1회(멱등: welcome_sent_at 공유).
 *   channel.enabled=false 면 발송 스킵(유입은 이미 됨). 실제 발송분만 기록.
 */
export async function sendChannelWelcome(brandId: string, channel: IntakeChannel): Promise<string[]> {
  if (!channel.enabled) return [];
  const b = await queryOne<{ brand_name: string; contact_name: string | null; email: string | null; phone: string | null; welcome_sent_at: string | null }>(
    "SELECT brand_name, contact_name, email, phone, welcome_sent_at FROM brands WHERE id=$1", [brandId]);
  if (!b || b.welcome_sent_at) return [];  // 이미 안내 발송됨(1회)

  const vars = { "브랜드명": b.brand_name, "담당자명": b.contact_name || b.brand_name };
  const sent: string[] = [];

  if (channel.send_sms && b.phone && channel.sms_template.trim()) {
    const r = await sendSms({ receiver: b.phone, msg: render(channel.sms_template, vars) }).catch(() => ({ ok: false } as { ok: boolean }));
    if (r.ok) sent.push("sms");
  }
  if (channel.send_email && b.email && (channel.email_subject.trim() || channel.email_body.trim())) {
    const r = await sendEmail({
      to: b.email, subject: render(channel.email_subject || `[GloveK] ${b.brand_name}님 안내`, vars),
      text: render(channel.email_body, vars),
    });
    if (r.ok) sent.push("email");
  }

  if (sent.length) {
    await query("UPDATE brands SET welcome_sent_at=now(), welcome_channels=$2, last_contact_at=now() WHERE id=$1", [brandId, sent]);
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'admin','contact_logged',$2,now())`,
      [brandId, JSON.stringify({ channel: sent.join("+"), kind: "welcome", intake: channel.name })]).catch(() => {});
  }
  return sent;
}
