// 소개자료 발송 — 설정(intro_config)에 정해진 소개 문자·이메일 내용으로 브랜드에 발송.
//   브랜드360 '소개자료 보내기' 에서 채널 선택 → 미리보기 → 발송.
import { query, queryOne } from "./db";
import { sendSms } from "./sms";
import { sendEmail } from "./mailer";

export interface IntroConfig {
  send_sms: boolean; send_email: boolean;
  sms_template: string; email_subject: string; email_body: string;
}

const FALLBACK: IntroConfig = {
  send_sms: true, send_email: true,
  sms_template: "[GloveK] {브랜드명}님, 요청하신 소개자료 보내드립니다. 자세한 내용은 이메일을 확인해 주세요.",
  email_subject: "[GloveK] {브랜드명}님께 — 회사·서비스 소개자료",
  email_body: "{브랜드명} 담당자님, 안녕하세요. GloveK입니다.\n\n요청 주신 소개자료를 보내드립니다.\n\n[소개자료 링크]\n\n감사합니다.\nGloveK 드림",
};

export async function getIntroConfig(): Promise<IntroConfig> {
  const r = await queryOne<IntroConfig>(
    "SELECT send_sms, send_email, sms_template, email_subject, email_body FROM intro_config WHERE id=1",
  ).catch(() => null);
  return r ?? FALLBACK;
}

export async function saveIntroConfig(c: Partial<IntroConfig>): Promise<void> {
  await query(
    `UPDATE intro_config SET
       send_sms=COALESCE($1,send_sms), send_email=COALESCE($2,send_email),
       sms_template=COALESCE($3,sms_template), email_subject=COALESCE($4,email_subject),
       email_body=COALESCE($5,email_body), updated_at=now() WHERE id=1`,
    [c.send_sms ?? null, c.send_email ?? null, c.sms_template ?? null, c.email_subject ?? null, c.email_body ?? null]);
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(브랜드명|담당자명)\}/g, (_, k) => vars[k] ?? "").replace(/\\n/g, "\n");
}

export interface IntroPreview {
  brand_name: string;
  email: string | null;
  phone: string | null;
  send_sms: boolean;   // 설정 기본 채널 on/off
  send_email: boolean;
  sms: string;         // 치환된 문자 내용
  subject: string;     // 치환된 이메일 제목
  body: string;        // 치환된 이메일 본문
}

/** 발송 전 미리보기 — 브랜드 연락처 + 설정 내용을 치환해 예시로 보여준다. */
export async function previewIntro(brandId: string): Promise<IntroPreview | null> {
  const b = await queryOne<{ brand_name: string; contact_name: string | null; email: string | null; phone: string | null }>(
    "SELECT brand_name, contact_name, email, phone FROM brands WHERE id=$1", [brandId]);
  if (!b) return null;
  const cfg = await getIntroConfig();
  const vars = { "브랜드명": b.brand_name, "담당자명": b.contact_name || b.brand_name };
  return {
    brand_name: b.brand_name, email: b.email, phone: b.phone,
    send_sms: cfg.send_sms, send_email: cfg.send_email,
    sms: render(cfg.sms_template, vars),
    subject: render(cfg.email_subject, vars),
    body: render(cfg.email_body, vars),
  };
}

export interface IntroSendResult { ok: boolean; sent: string[]; errors: string[] }

/** 소개자료 발송 — 선택 채널(sms/email)로 발송. 연락처·설정 없으면 사유를 errors 로. */
export async function sendIntro(brandId: string, want: { sms: boolean; email: boolean }): Promise<IntroSendResult> {
  const b = await queryOne<{ brand_name: string; contact_name: string | null; email: string | null; phone: string | null }>(
    "SELECT brand_name, contact_name, email, phone FROM brands WHERE id=$1", [brandId]);
  if (!b) return { ok: false, sent: [], errors: ["브랜드 없음"] };
  const cfg = await getIntroConfig();
  const vars = { "브랜드명": b.brand_name, "담당자명": b.contact_name || b.brand_name };
  const sent: string[] = [];
  const errors: string[] = [];

  if (want.sms) {
    if (!b.phone) errors.push("문자: 연락처(전화번호) 없음");
    else {
      const r = await sendSms({ receiver: b.phone, msg: render(cfg.sms_template, vars) }).catch(() => ({ ok: false } as { ok: boolean }));
      if (r.ok) sent.push("sms"); else errors.push("문자: 발송 실패(ALIGO 설정 확인)");
    }
  }
  if (want.email) {
    if (!b.email) errors.push("이메일: 주소 없음");
    else {
      const r = await sendEmail({ to: b.email, subject: render(cfg.email_subject, vars), text: render(cfg.email_body, vars) });
      if (r.ok) sent.push("email"); else errors.push(`이메일: ${r.skipped ? "발송 미설정(Gmail/Resend)" : "발송 실패"}`);
    }
  }

  if (sent.length) {
    await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [brandId]).catch(() => {});
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'admin','contact_logged',$2,now())`,
      [brandId, JSON.stringify({ channel: sent.join("+"), kind: "intro" })]).catch(() => {});
  }
  return { ok: sent.length > 0, sent, errors };
}
