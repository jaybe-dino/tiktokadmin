// iCalendar(ICS) 파서 — 이메일에 첨부된 캘린더 초대(VEVENT)에서 일정·참석자 추출.
//   공용 메일함 수집 시 초대 메일을 미팅 캘린더로 자동 맵핑하는 데 사용.

export interface IcsAddr { name?: string; email: string }
export interface IcsEvent {
  uid: string;
  summary: string;
  startIso: string | null;   // UTC ISO
  location: string;
  organizer: IcsAddr | null;
  attendees: IcsAddr[];
  method: string;            // REQUEST | CANCEL | ...
}

function unescapeIcs(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

/** ICS 날짜(DTSTART) → UTC ISO. Z=UTC, TZID=Asia/Seoul 는 -9h 보정, 그 외 naive 는 UTC 취급. */
function parseIcsDate(left: string, val: string): string | null {
  const raw = val.trim();
  // 날짜만(YYYYMMDD)
  const dateOnly = /^\d{8}$/.test(raw) || /VALUE=DATE(?!-)/i.test(left);
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mm = "00", ss = "00", z] = m;
  if (dateOnly) return `${y}-${mo}-${d}T00:00:00.000Z`;
  let date = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss));
  if (!z) {
    // naive local time — TZID 이 KST 면 UTC 로 보정(-9h). 그 외는 그대로 UTC 취급.
    if (/TZID=[^:;]*(seoul|kst|korea)/i.test(left)) date = new Date(date.getTime() - 9 * 3_600_000);
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseCalAddr(left: string, val: string): IcsAddr | null {
  const email = val.replace(/^mailto:/i, "").trim().toLowerCase();
  if (!email.includes("@")) return null;
  const cn = left.match(/CN=("?)([^;":]+)\1/i);
  return { name: cn ? cn[2].trim() : undefined, email };
}

/** ICS 텍스트 파싱 → 첫 VEVENT. UID/SUMMARY 둘 다 없으면 null. */
export function parseIcs(raw: string): IcsEvent | null {
  // 라인 언폴딩(RFC5545): CRLF/LF + 공백/탭 이어붙임.
  const text = raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = text.split(/\r?\n/);
  let inEvent = false;
  let method = "";
  const ev: { uid?: string; summary?: string; location?: string; startIso?: string | null; organizer?: IcsAddr | null; attendees: IcsAddr[] } = { attendees: [] };
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const left = line.slice(0, idx);
    const val = line.slice(idx + 1);
    const name = left.split(";")[0].trim().toUpperCase();
    if (name === "METHOD") { method = val.trim().toUpperCase(); continue; }
    if (name === "BEGIN" && val.trim().toUpperCase() === "VEVENT") { inEvent = true; continue; }
    if (name === "END" && val.trim().toUpperCase() === "VEVENT") { inEvent = false; continue; }
    if (!inEvent) continue;
    if (name === "UID") ev.uid = val.trim();
    else if (name === "SUMMARY") ev.summary = unescapeIcs(val);
    else if (name === "LOCATION") ev.location = unescapeIcs(val);
    else if (name === "DTSTART") ev.startIso = parseIcsDate(left, val);
    else if (name === "ORGANIZER") ev.organizer = parseCalAddr(left, val);
    else if (name === "ATTENDEE") { const a = parseCalAddr(left, val); if (a) ev.attendees.push(a); }
  }
  if (!ev.uid && !ev.summary) return null;
  return {
    uid: ev.uid ?? "",
    summary: ev.summary ?? "",
    startIso: ev.startIso ?? null,
    location: ev.location ?? "",
    organizer: ev.organizer ?? null,
    attendees: ev.attendees,
    method: method || "REQUEST",
  };
}
