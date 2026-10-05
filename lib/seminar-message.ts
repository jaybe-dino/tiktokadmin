// 세미나 안내 문구 조립 — 실제 발송과 미리보기가 "같은 함수"를 쓰도록 모아 둔 곳.
//
//   이 파일이 생긴 이유
//     실제 발송은 회차 스냅샷(seminar_sessions.session_title)을, 미리보기는 설정값
//     (seminar_config.session_title)을 따로 읽어 서로 다른 제목이 나갔다.
//     이제 양쪽 다 seminarVars() → composeSeminarMessage() 를 거친다.
//
//   일부러 하지 않는 것
//     · 회차 스냅샷(seminar_sessions)을 고쳐 쓰지 않는다 — 지난 발송 기록은 그대로 둔다.
//     · 2차(followup) 문구 내용을 건드리지 않는다. 치환만 한다.
//     · 네트워크를 타지 않는다(조립만 한다). 전송은 호출부가 한다.
import { renderTemplate, sessionLabel, normPhone, type SeminarChannel } from "./seminar-schedule";
import { withSmsOptout, withMailOptout } from "./ad-optout";

/** 설정·회차 어디에도 제목이 없을 때만 쓰는 최후 기본값. */
export const DEFAULT_SESSION_TITLE = "GloveK 온라인 세미나";

export interface SeminarVars {
  브랜드명: string; 담당자명: string; 일시: string; 줌링크: string; 세미나명: string;
}

export interface SeminarVarsInput {
  brandName?: string | null;
  contactName?: string | null;
  /** 안내에 적을 회차 시각(1차=시작, 2차=후속 시작). */
  at: Date;
  /** seminar_config.session_title — 앞으로의 발송·미리보기 기준값. */
  configTitle?: string | null;
  /** seminar_sessions.session_title — 과거 회차 스냅샷. 설정이 비었을 때만 쓴다. */
  sessionTitle?: string | null;
  configZoomUrl?: string | null;
  /** 그 회차에 고정된 참가 링크. 이미 안내한 링크를 유지해야 하므로 설정값보다 먼저다. */
  sessionZoomUrl?: string | null;
}

const t = (v: string | null | undefined) => (v ?? "").trim();

/**
 * 치환 변수 한 벌. 실제 발송·미리보기·테스트 발송이 모두 이 함수를 쓴다.
 *   · 세미나명: 설정값 > 회차 스냅샷 > 기본값
 *     (제목 기준을 "지금 설정"으로 통일한다. 과거 스냅샷을 덮어쓰지는 않는다.)
 *   · 줌링크: 회차 스냅샷 > 설정값
 *     (그 회차 참가자에게 이미 안내한 링크가 바뀌면 안 되므로 반대 순서다.)
 */
export function seminarVars(i: SeminarVarsInput): SeminarVars {
  const brand = t(i.brandName);
  const contact = t(i.contactName);
  return {
    브랜드명: brand || "고객",
    담당자명: contact || brand || "고객",
    일시: sessionLabel(i.at),
    줌링크: t(i.sessionZoomUrl) || t(i.configZoomUrl),
    세미나명: t(i.configTitle) || t(i.sessionTitle) || DEFAULT_SESSION_TITLE,
  };
}

export interface ComposeInput {
  channel: SeminarChannel;
  /** 'ad' 면 수신거부 안내를 붙인다. 'service' 면 붙이지 않는다. */
  purpose: string;
  template: { emailSubject: string; emailBody: string; smsBody: string };
  vars: SeminarVars;
  /** 광고성 단계에서만 쓰는 수신거부 주소. */
  optoutUrl?: string;
  /** 테스트 발송 표시처럼 제목·본문 앞에 붙이는 말. */
  mark?: string;
  /** 본문 끝에 덧붙이는 안내(테스트 안내문 등). */
  footNote?: string;
}

/** 실제로 전송되는 최종 제목·본문. 기록도 이 값을 그대로 남긴다. */
export interface ComposedMessage { subject: string; body: string }

export function composeSeminarMessage(i: ComposeInput): ComposedMessage {
  const isSms = i.channel === "sms";
  let body = renderTemplate(isSms ? i.template.smsBody : i.template.emailBody, i.vars);
  let subject = isSms ? "" : renderTemplate(i.template.emailSubject, i.vars);

  const mark = t(i.mark);
  if (mark) {
    body = `${mark} ${body}`.trim();
    if (!isSms) subject = `${mark} ${subject}`.trim();
  }
  // 광고성 단계는 기존 수신거부 규칙을 그대로 적용한다 — 기록에도 이 꼬리말이 포함된다.
  const optout = t(i.optoutUrl);
  if (i.purpose === "ad" && optout) {
    body = isSms ? withSmsOptout(body, optout) : withMailOptout(body, optout);
  }
  const foot = t(i.footNote);
  if (foot) body = [body, "", foot].join("\n");
  return { subject, body };
}

/** 기록에 남길 수신자 표기. 원문 연락처는 남기지 않는다. */
export function maskTo(channel: SeminarChannel, raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (channel === "sms") {
    const d = normPhone(v);
    return d.length >= 7 ? `${d.slice(0, 3)}****${d.slice(-4)}` : "***";
  }
  const [id, dom] = v.split("@");
  if (!dom) return "***";
  return `${id.slice(0, 2)}${"*".repeat(Math.max(1, id.length - 2))}@${dom}`;
}
