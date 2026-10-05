// 세미나 안내 — 지정 수신자 테스트 발송(관리자 전용).
//   목적: 마스터 스위치·문구 활성화 없이, 저장된 1차 참가안내가 실제로 어떻게 도착하는지
//         담당자 본인 연락처로 1건씩 확인한다.
//
//   지키는 것
//     · 보낼 주소는 seminar_config 에 저장된 테스트 연락처뿐이다. 화면에서 넘어온 주소를 쓰지 않는다.
//     · 치환·발송 경로는 실제 안내와 같다(같은 템플릿·같은 renderTemplate·같은 sendSms/sendEmail).
//     · 본문·제목 앞에 [테스트] 를 붙여 실제 안내와 구분한다.
//     · 고객 회차·대상·발송 원장과 수신거부 기록을 읽지도 쓰지도 않는다.
//     · 같은 채널로 동시에 두 번 나가지 않는다(부분 유니크 인덱스로 선점).
//     · 2차(후속) 문구는 내용 미확정이라 이 경로에서 실제 발송하지 않는다 — 미리보기만 된다.
import { query, queryOne } from "./db";
import { getSeminarConfig, listSeminarTemplates, type SeminarConfig } from "./seminar";
import { atKst, normPhone, normEmail, isHttpUrl, type SeminarChannel, type SeminarStage } from "./seminar-schedule";
// 실제 발송과 "같은" 치환·조립 함수를 쓴다 — 미리보기와 실제 제목이 갈라지지 않게.
import { seminarVars, composeSeminarMessage, maskTo as maskAddr } from "./seminar-message";

export const SEMINAR_TEST_MIGRATION = "0105_seminar_test_send.sql";
/** 선점된 채 멈춘 테스트 발송을 되돌리기까지의 시간(분). */
export const TEST_CLAIM_STALE_MIN = 2;
/** 실제 전송이 허용된 단계 — 2차는 내용 미확정이라 제외한다. */
export const TEST_SENDABLE_STAGES: SeminarStage[] = ["notice"];
/** 문구·제목 앞에 붙는 표시. 받는 사람이 실제 안내와 헷갈리지 않게 한다. */
export const TEST_MARK = "[테스트]";
export const TEST_BODY_NOTE = "※ 발송 점검용 테스트입니다. 실제 세미나 안내가 아닙니다.";

export async function seminarTestSchema(): Promise<{ ready: boolean; error?: string }> {
  try {
    const t = await queryOne<{ reg: string | null }>(
      "SELECT to_regclass('public.seminar_test_sends')::text AS reg");
    if (!t?.reg) return { ready: false, error: `마이그레이션 ${SEMINAR_TEST_MIGRATION} 미적용 — seminar_test_sends 표가 없습니다.` };
    const c = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='seminar_config'
          AND column_name = ANY($1::text[])`, [["test_phone", "test_email"]]);
    const have = new Set(c.map((x) => x.column_name));
    const missing = ["test_phone", "test_email"].filter((x) => !have.has(x));
    if (missing.length) return { ready: false, error: `마이그레이션 ${SEMINAR_TEST_MIGRATION} 미적용 — 없는 컬럼: ${missing.join(", ")}` };
    return { ready: true };
  } catch (e) {
    return { ready: false, error: `스키마 확인 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

export interface TestRecipients { phone: string; email: string }

export async function getTestRecipients(): Promise<TestRecipients> {
  const r = await queryOne<{ test_phone: string; test_email: string }>(
    "SELECT coalesce(test_phone,'') AS test_phone, coalesce(test_email,'') AS test_email FROM seminar_config WHERE id=1");
  return { phone: r?.test_phone ?? "", email: r?.test_email ?? "" };
}

/** 테스트 수신자 저장. 형식을 확인하고, 저장된 값만 나중에 실제 수신자가 된다. */
export async function setTestRecipients(input: { phone?: string; email?: string }, by: string):
  Promise<{ ok: boolean; error?: string }> {
  const phone = input.phone === undefined ? undefined : normPhone(input.phone);
  const email = input.email === undefined ? undefined : normEmail(input.email);
  if (phone !== undefined && phone && !/^01[016789]\d{7,8}$/.test(phone)) {
    return { ok: false, error: "휴대폰 번호 형식이 아닙니다(010…)." };
  }
  if (email !== undefined && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "이메일 형식이 아닙니다." };
  }
  const set: string[] = [];
  const args: unknown[] = [];
  if (phone !== undefined) { args.push(phone); set.push(`test_phone=$${args.length}`); }
  if (email !== undefined) { args.push(email); set.push(`test_email=$${args.length}`); }
  if (set.length === 0) return { ok: true };
  args.push(by);
  await query(`UPDATE seminar_config SET ${set.join(", ")}, updated_by=$${args.length}, updated_at=now() WHERE id=1`, args);
  return { ok: true };
}

/** 주소 마스킹 — 원장에는 마스킹한 값만 남긴다. */
/** 공용 구현을 그대로 쓴다(실제 발송 기록과 같은 모양으로 남게). */
export function maskTo(channel: SeminarChannel, raw: string): string {
  return maskAddr(channel, raw);
}

export interface TestPreview {
  ok: boolean;
  error?: string;
  channel: SeminarChannel;
  stage: SeminarStage;
  /** 실제 보낼 수 있는 단계인지 — 2차는 false(미리보기만). */
  sendable: boolean;
  toMasked: string;
  subject: string;
  body: string;
  sessionDate: string;
  /** 지금 보낼 수 없는 이유(있으면 발송 버튼이 막힌다). */
  blockers: string[];
}

const DEFAULT_SESSION_DATE = "2026-10-05";
const TEST_VARS_BRAND = "테스트 브랜드";
const TEST_VARS_CONTACT = "Jaybe";

/**
 * 보낼 내용을 그대로 만들어 돌려준다(전송하지 않는다).
 *   실제 안내와 같은 템플릿·같은 치환을 쓰고, 앞에 [테스트] 표시만 더한다.
 */
export async function previewSeminarTest(input: { channel: SeminarChannel; stage?: SeminarStage; sessionDate?: string }):
  Promise<TestPreview> {
  const channel = input.channel;
  const stage: SeminarStage = input.stage ?? "notice";
  const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate ?? "") ? input.sessionDate! : DEFAULT_SESSION_DATE;
  const base: TestPreview = {
    ok: false, channel, stage, sendable: TEST_SENDABLE_STAGES.includes(stage),
    toMasked: "", subject: "", body: "", sessionDate, blockers: [],
  };

  const schema = await seminarTestSchema();
  if (!schema.ready) return { ...base, error: schema.error, blockers: [schema.error ?? "스키마 미적용"] };

  let cfg: SeminarConfig;
  try { cfg = await getSeminarConfig(); }
  catch (e) { return { ...base, error: (e as Error).message.slice(0, 200), blockers: ["설정을 불러오지 못했습니다"] }; }

  const rec = await getTestRecipients();
  const to = channel === "sms" ? rec.phone : rec.email;
  const blockers: string[] = [];
  if (!to) blockers.push(`${channel === "sms" ? "테스트 문자 번호" : "테스트 메일 주소"}를 먼저 저장하세요`);
  if (!isHttpUrl(cfg.zoomUrl)) blockers.push("고정 Zoom 링크가 설정되지 않았습니다");
  if (!base.sendable) blockers.push("2차 문구는 내용 미확정이라 실제 발송에서 제외됩니다(미리보기만)");

  const tpl = (await listSeminarTemplates()).find((t) => t.stage === stage);
  if (!tpl) return { ...base, error: "문구를 찾지 못했습니다.", blockers: [...blockers, "문구 없음"] };

  const at = stage === "notice"
    ? atKst(sessionDate, cfg.sessionHour, cfg.sessionMinute)
    : atKst(sessionDate, cfg.followupHour, cfg.followupMinute);
  // 회차 스냅샷이 없는 경로이므로 설정값만 넘긴다 — 기준은 실제 발송과 같다.
  const vars = seminarVars({
    brandName: TEST_VARS_BRAND, contactName: TEST_VARS_CONTACT, at,
    configTitle: cfg.sessionTitle, configZoomUrl: cfg.zoomUrl,
  });

  const rawBody = channel === "sms" ? tpl.smsBody : tpl.emailBody;
  if (!rawBody.trim()) blockers.push(`${channel === "sms" ? "문자" : "메일"} 문구 본문이 비어 있습니다`);
  if (channel === "email" && !tpl.emailSubject.trim()) blockers.push("메일 제목이 비어 있습니다");

  // 실제 발송과 같은 조립 함수. 테스트 경로만 [테스트] 표시와 안내문을 더한다.
  const composed = composeSeminarMessage({
    channel, purpose: tpl.purpose, vars,
    template: { emailSubject: tpl.emailSubject, emailBody: tpl.emailBody, smsBody: tpl.smsBody },
    mark: TEST_MARK, footNote: TEST_BODY_NOTE,
  });
  const subject = composed.subject;
  const body = composed.body;

  return {
    ok: blockers.length === 0,
    channel, stage, sendable: base.sendable, sessionDate,
    toMasked: maskTo(channel, to), subject, body, blockers,
  };
}

export interface TestSendResult {
  ok: boolean; error?: string;
  channel?: SeminarChannel;
  toMasked?: string;
  provider?: string;
  providerId?: string;
  subject?: string;
}

/**
 * 실제 전송. 저장된 테스트 연락처로만 1건 보낸다.
 *   고객 회차·대상·발송 원장과 수신거부 기록은 건드리지 않는다.
 */
export async function sendSeminarTest(input: { channel: SeminarChannel; sessionDate?: string; by: string }):
  Promise<TestSendResult> {
  const channel = input.channel;
  const stage: SeminarStage = "notice";   // 실제 발송은 1차 참가안내만.

  await releaseStaleTestSends();

  const pv = await previewSeminarTest({ channel, stage, sessionDate: input.sessionDate });
  if (!pv.ok) return { ok: false, error: pv.blockers.join(" · ") || pv.error || "보낼 수 없습니다." };

  // 서버가 저장된 연락처를 다시 읽어 실제 수신자를 정한다(화면 입력을 쓰지 않는다).
  const rec = await getTestRecipients();
  const to = channel === "sms" ? normPhone(rec.phone) : normEmail(rec.email);
  if (!to) return { ok: false, error: "테스트 수신자가 저장되어 있지 않습니다." };

  // 선점 — 같은 채널로 동시에 두 번 나가지 않는다(중복 클릭 방지).
  let claim: { id: string } | null;
  try {
    claim = await queryOne<{ id: string }>(
      `INSERT INTO seminar_test_sends (channel, stage, session_date, to_masked, subject, body_preview, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [channel, stage, pv.sessionDate, pv.toMasked, pv.subject.slice(0, 300), pv.body.slice(0, 2000), input.by]);
  } catch (e) {
    if (/seminar_test_sends_one_sending/.test((e as Error).message)) {
      return { ok: false, error: "같은 채널의 테스트 발송이 이미 진행 중입니다 — 잠시 후 다시 시도하세요." };
    }
    throw e;
  }
  if (!claim) return { ok: false, error: "테스트 발송을 기록하지 못했습니다." };

  try {
    if (channel === "sms") {
      const { sendSms } = await import("./sms");
      const out = await sendSms({ receiver: to, msg: pv.body, title: "GloveK 세미나 테스트" });
      if (!out.ok) {
        await query("UPDATE seminar_test_sends SET status='failed', error=$2 WHERE id=$1",
          [claim.id, (out.message ?? "발송 실패").slice(0, 300)]);
        return { ok: false, error: out.message ?? "문자 발송 실패", channel, toMasked: pv.toMasked };
      }
      await query(
        "UPDATE seminar_test_sends SET status='sent', sent_at=now(), provider='aligo', provider_id=$2 WHERE id=$1",
        [claim.id, (out.msgId ?? "").slice(0, 200)]);
      return { ok: true, channel, toMasked: pv.toMasked, provider: "aligo", providerId: out.msgId };
    }
    const { sendEmail } = await import("./mailer");
    const out = await sendEmail({ to, subject: pv.subject, text: pv.body });
    if (!out.ok) {
      await query("UPDATE seminar_test_sends SET status='failed', error=$2 WHERE id=$1",
        [claim.id, (out.error ?? (out.skipped ? "메일 발송 설정이 없습니다" : "발송 실패")).slice(0, 300)]);
      return { ok: false, error: out.error ?? "메일 발송 실패", channel, toMasked: pv.toMasked };
    }
    await query(
      "UPDATE seminar_test_sends SET status='sent', sent_at=now(), provider=$2, provider_id=$3 WHERE id=$1",
      [claim.id, (out.via ?? "mail").slice(0, 40), (out.id ?? "").slice(0, 200)]);
    return { ok: true, channel, toMasked: pv.toMasked, provider: out.via, providerId: out.id, subject: pv.subject };
  } catch (e) {
    await query("UPDATE seminar_test_sends SET status='failed', error=$2 WHERE id=$1",
      [claim.id, (e as Error).message.slice(0, 300)]).catch(() => {});
    return { ok: false, error: (e as Error).message.slice(0, 200), channel, toMasked: pv.toMasked };
  }
}

/** 선점된 채 멈춘 건을 되돌린다(중간에 프로세스가 죽어도 다음 시도가 막히지 않게). */
export async function releaseStaleTestSends(now = new Date()): Promise<number> {
  const r = await query<{ id: string }>(
    `UPDATE seminar_test_sends SET status='canceled', error='응답이 없어 취소됨'
      WHERE status='sending' AND created_at < $1 RETURNING id`,
    [new Date(now.getTime() - TEST_CLAIM_STALE_MIN * 60_000).toISOString()]).catch(() => []);
  return r.length;
}

export interface TestSendRow {
  id: string; channel: string; stage: string; session_date: string | null;
  to_masked: string; subject: string; status: string;
  provider: string; provider_id: string; error: string;
  created_by: string | null; created_at: string; sent_at: string | null;
}
export async function listTestSends(limit = 20): Promise<TestSendRow[]> {
  return query<TestSendRow>(
    `SELECT id, channel, stage, session_date::text AS session_date, to_masked, subject, status,
            provider, provider_id, error, created_by,
            created_at::text AS created_at, sent_at::text AS sent_at
       FROM seminar_test_sends ORDER BY created_at DESC LIMIT $1`, [limit]);
}
