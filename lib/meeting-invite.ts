// 미팅 초대 — ICS(text/calendar VEVENT) 생성 + 참석자 이메일 초대 발송 (PLAN §8 미팅).
//   · ICS 는 METHOD:REQUEST 로 생성 → 메일 클라이언트/캘린더에 일정 박제·알림.
//   · 발송은 lib/mailer sendEmail(Resend) 경유 — RESEND_API_KEY 미설정 시 skipped 반환.
//   · 순수 문자열 생성 + 발송만. DB 접근 없음(호출측 서버액션이 데이터를 넘긴다).
import { sendEmail } from "./mailer";

export interface Attendee {
  name: string;
  email: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Date(instant) → ICS UTC 포맷(YYYYMMDDTHHMMSSZ) */
export function icsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Date(instant) → "YYYY-MM-DD HH:MM" (KST, 메일 본문 표기용) */
export function kstLabel(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}

/** ICS TEXT 이스케이프 (RFC5545 §3.3.11) */
function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** 75옥텟 라인 폴딩 (한글 = UTF-8 3바이트 — 바이트 기준으로 접는다) */
function foldLine(line: string): string {
  const MAX = 73; // 여유 2옥텟
  if (Buffer.byteLength(line, "utf8") <= MAX) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (curBytes + b > MAX) {
      out.push(cur);
      cur = " " + ch; // 연속행은 공백 접두
      curBytes = 1 + b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n");
}

export interface MeetingIcsInput {
  uid: string;                 // 멱등 UID (같은 미팅 재발송 시 동일 UID + SEQUENCE 증가 → 캘린더가 갱신)
  start: Date;                 // 시작(instant)
  durationMin?: number;        // 기본 60분
  summary: string;             // 제목
  description: string;         // 본문(줌링크 포함 권장)
  location?: string;           // 줌 링크
  organizerEmail: string;
  organizerName?: string;
  attendees: Attendee[];
  sequence?: number;           // 일정 변경 재초대 시 증가값
}

/** VCALENDAR/VEVENT(METHOD:REQUEST) 문자열 생성 */
export function buildMeetingIcs(input: MeetingIcsInput): string {
  const dur = input.durationMin && input.durationMin > 0 ? input.durationMin : 60;
  const end = new Date(input.start.getTime() + dur * 60_000);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//GloveK//Admin Meetings//KO",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${icsEscape(input.uid)}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(input.start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsEscape(input.summary)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
  ];
  if (input.location) {
    lines.push(`LOCATION:${icsEscape(input.location)}`);
    lines.push(`URL:${input.location}`);
  }
  const orgName = icsEscape(input.organizerName ?? input.organizerEmail);
  lines.push(`ORGANIZER;CN=${orgName}:mailto:${input.organizerEmail}`);
  for (const a of input.attendees) {
    lines.push(
      `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${icsEscape(a.name || a.email)}:mailto:${a.email}`,
    );
  }
  lines.push(
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:GloveK 미팅 15분 전",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export interface InviteSendResult {
  sent: number;
  failed: number;
  skipped: boolean; // RESEND 미설정
  errors: string[];
}

export interface SendMeetingInvitesInput {
  meetingId: string;           // UID 시드(멱등 — 수정 재발송 시 sequence 만 올린다)
  topic: string;
  brandName?: string | null;
  start: Date;
  durationMin?: number;
  zoomJoinUrl: string;
  hostEmail: string;
  hostName?: string;
  attendees: Attendee[];
  sequence?: number;
  isUpdate?: boolean;          // 일정 변경 재초대 여부(제목·본문 문구)
}

/** 참석자 전원에게 ICS 첨부 초대 메일 발송. RESEND 미설정 시 발송 스킵. */
export async function sendMeetingInvites(input: SendMeetingInvitesInput): Promise<InviteSendResult> {
  const result: InviteSendResult = { sent: 0, failed: 0, skipped: false, errors: [] };
  if (input.attendees.length === 0) return result;

  const when = kstLabel(input.start);
  const title = `${input.brandName ? `[${input.brandName}] ` : ""}${input.topic || "1:1 미팅"}`;
  const description = [
    `GloveK ${title}`,
    ``,
    `일시: ${when} (KST)`,
    `줌 참가 링크: ${input.zoomJoinUrl}`,
    `호스트: ${input.hostName ? `${input.hostName} <${input.hostEmail}>` : input.hostEmail}`,
  ].join("\n");

  const ics = buildMeetingIcs({
    uid: `glovek-meeting-${input.meetingId}@glovek.space`,
    start: input.start,
    durationMin: input.durationMin,
    summary: `[GloveK] ${title}`,
    description,
    location: input.zoomJoinUrl,
    organizerEmail: input.hostEmail,
    organizerName: input.hostName,
    attendees: input.attendees,
    sequence: input.sequence ?? 0,
  });
  const icsB64 = Buffer.from(ics, "utf8").toString("base64");

  const subject = input.isUpdate
    ? `[GloveK] 미팅 일정 변경 안내 — ${title} (${when})`
    : `[GloveK] 미팅 초대 — ${title} (${when})`;

  for (const a of input.attendees) {
    const text = [
      `안녕하세요, ${a.name || "담당자"}님. GloveK입니다.`,
      ``,
      input.isUpdate
        ? `${title} 미팅 일정이 아래와 같이 변경되어 다시 안내드립니다.`
        : `${title} 미팅 일정을 아래와 같이 안내드립니다.`,
      ``,
      `· 일시: ${when} (KST)`,
      `· 줌 참가 링크: ${input.zoomJoinUrl}`,
      `· 호스트: ${input.hostName ? `${input.hostName} (${input.hostEmail})` : input.hostEmail}`,
      ``,
      `첨부된 캘린더 초대(invite.ics)를 열면 일정이 캘린더에 등록되고 시작 전 알림을 받을 수 있습니다.`,
      `일정 조율이 필요하시면 이 메일에 회신 주세요. 감사합니다.`,
    ].join("\n");

    const r = await sendEmail({
      to: a.email,
      subject,
      text,
      replyTo: input.hostEmail,
      attachments: [{ filename: "invite.ics", content: icsB64, mimeType: "text/calendar; method=REQUEST; charset=UTF-8" }],
    });
    if (r.skipped) {
      // RESEND 미설정 — 전체 스킵으로 간주하고 종료(등록 자체는 성공 유지).
      result.skipped = true;
      return result;
    }
    if (r.ok) result.sent += 1;
    else {
      result.failed += 1;
      result.errors.push(`${a.email}: ${r.error ?? "발송 실패"}`);
    }
  }
  return result;
}
