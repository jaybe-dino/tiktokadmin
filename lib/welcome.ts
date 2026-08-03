// 신규 리드 자동 안내 (16) — 안내 대상 리드에 기본 문자+이메일 1회 발송.
//   자동: enabled + lead source ∈ sources 이고 아직 미발송이면 유입 즉시.
//   수동: 리드 목록에서 체크한 브랜드에 즉시(sendWelcome force).
//   원칙: 유입(고객이 먼저 문의)에 대한 거래성 응답으로 취급. 1회만(멱등).
import { query, queryOne } from "./db";
import { sendSms } from "./sms";
import { sendEmail } from "./mailer";

export interface WelcomeConfig {
  enabled: boolean; sources: string[]; send_sms: boolean; send_email: boolean;
  sms_template: string; email_subject: string; email_body: string;
}

export async function getWelcomeConfig(): Promise<WelcomeConfig> {
  const r = await queryOne<WelcomeConfig>("SELECT enabled, sources, send_sms, send_email, sms_template, email_subject, email_body FROM welcome_config WHERE id=1").catch(() => null);
  return r ?? { enabled: false, sources: [], send_sms: true, send_email: true, sms_template: "", email_subject: "", email_body: "" };
}

export async function saveWelcomeConfig(c: Partial<WelcomeConfig>): Promise<void> {
  await query(
    `UPDATE welcome_config SET
       enabled=COALESCE($1,enabled), sources=COALESCE($2,sources),
       send_sms=COALESCE($3,send_sms), send_email=COALESCE($4,send_email),
       sms_template=COALESCE($5,sms_template), email_subject=COALESCE($6,email_subject),
       email_body=COALESCE($7,email_body), updated_at=now() WHERE id=1`,
    [c.enabled ?? null, c.sources ?? null, c.send_sms ?? null, c.send_email ?? null,
     c.sms_template ?? null, c.email_subject ?? null, c.email_body ?? null]);
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(브랜드명|담당자명)\}/g, (_, k) => vars[k] ?? "").replace(/\\n/g, "\n");
}

export interface WelcomeResult { ok: boolean; sent: string[]; skipped?: string; error?: string }

/** 브랜드 1건에 안내 발송. force=false 면 이미 보냈으면 스킵. */
export async function sendWelcome(brandId: string, force = false): Promise<WelcomeResult> {
  const b = await queryOne<{ brand_name: string; contact_name: string | null; email: string | null; phone: string | null; welcome_sent_at: string | null }>(
    "SELECT brand_name, contact_name, email, phone, welcome_sent_at FROM brands WHERE id=$1", [brandId]);
  if (!b) return { ok: false, sent: [], error: "브랜드 없음" };
  if (b.welcome_sent_at && !force) return { ok: true, sent: [], skipped: "이미 발송됨" };

  const cfg = await getWelcomeConfig();
  const vars = { "브랜드명": b.brand_name, "담당자명": b.contact_name || b.brand_name };
  const sent: string[] = [];

  // 템플릿 CRUD(기획 9절): msg_templates 의 welcome_sms/welcome_email 이 있으면 우선 사용
  const { getTemplate, renderTemplate } = await import("./templates");
  const tplSms = await getTemplate("welcome_sms");
  const tplEmail = await getTemplate("welcome_email");

  // 문자 — 유입(문의)에 대한 거래성 응답(kind=welcome)
  if (cfg.send_sms && b.phone) {
    const body = tplSms ? renderTemplate(tplSms.body, vars) : render(cfg.sms_template, vars);
    const r = await sendSms({ receiver: b.phone, msg: body }).catch(() => ({ ok: false } as { ok: boolean }));
    if (r.ok) sent.push("sms");
  }
  // 이메일
  if (cfg.send_email && b.email) {
    const subject = tplEmail?.subject ? renderTemplate(tplEmail.subject, vars) : render(cfg.email_subject, vars);
    const body = tplEmail ? renderTemplate(tplEmail.body, vars) : render(cfg.email_body, vars);
    const r = await sendEmail({ to: b.email, subject, text: body });
    if (r.ok) sent.push("email");
  }

  // 실제로 한 채널이라도 나갔을 때만 발송기록. 미발송(수단 없음/실패)이면
  //   welcome_sent_at 미세팅 → 조건 충족 시 재시도 가능(영구 차단 방지).
  if (sent.length) {
    await query("UPDATE brands SET welcome_sent_at=now(), welcome_channels=$2, last_contact_at=now() WHERE id=$1", [brandId, sent]);
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'admin','contact_logged',$2,now())`,
      [brandId, JSON.stringify({ channel: sent.join("+"), kind: "welcome" })]).catch(() => {});
    return { ok: true, sent };
  }
  return { ok: true, sent, skipped: "발송 수단 없음(연락처·발송설정 확인) — 재시도 가능" };
}

/** 유입 즉시 자동 안내: enabled + source 대상 + 미발송일 때만. (ingest 에서 호출) */
export async function maybeAutoWelcome(brandId: string, source: string): Promise<void> {
  const cfg = await getWelcomeConfig();
  if (!cfg.enabled) return;
  if (!cfg.sources.includes(source)) return;
  await sendWelcome(brandId, false).catch(() => {});
}
