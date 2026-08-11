// Gmail 도메인 위임 수집 (09-A) — 서비스계정 JWT + Gmail REST (googleapis 의존성 없이).
//   env GOOGLE_SA_KEY_JSON = 서비스계정 키 JSON({client_email, private_key}).
//   각 admin_users.gmail_sync_enabled 계정을 impersonate 해 최근 메일을 브랜드 매칭 후 적재.
import crypto from "node:crypto";
import { env } from "./env";
import { query } from "./db";
import { matchBrandByAddresses, ingestEmailMessage } from "./email-sync";

const SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly";
// compose: 임시보관함(초안) 생성/수정 + 메시지 발송. 지정 메일함 발송·임시저장에 필요.
const SCOPE_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

interface SaKey { client_email: string; private_key: string }

function loadSaKey(): SaKey | null {
  const raw = env.gmail.saKeyJson;
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as SaKey;
    return k.client_email && k.private_key ? k : null;
  } catch {
    return null;
  }
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

/** 서비스계정 → 특정 사용자(sub) impersonate 액세스 토큰. scope 기본=읽기전용. */
async function getAccessToken(sub: string, scope = SCOPE_READ): Promise<string | null> {
  const sa = loadSaKey();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, sub, scope, aud: TOKEN_URI, iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(sa.private_key);
  const jwt = `${signingInput}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    console.error("[gmail] token error", await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  return data.access_token ?? null;
}

interface GmailHeader { name: string; value: string }
function headerVal(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}
function parseAddrs(v: string): string[] {
  // "이름 <a@b.com>, c@d.com" → ["a@b.com","c@d.com"]
  return v.split(",").map((p) => {
    const m = p.match(/<([^>]+)>/);
    return (m ? m[1] : p).trim().toLowerCase();
  }).filter((e) => e.includes("@"));
}

interface GmailPart { mimeType?: string; filename?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] }

/** MIME 트리에서 text/calendar(ICS) 파트 추출 — 인라인 data 우선, 없으면 첨부 fetch. */
async function extractCalendar(payload: GmailPart | undefined, auth: Record<string, string>, msgId: string): Promise<string> {
  if (!payload) return "";
  const find = (part: GmailPart): GmailPart | null => {
    const mt = (part.mimeType || "").toLowerCase();
    const fn = (part.filename || "").toLowerCase();
    if (mt.startsWith("text/calendar") || mt === "application/ics" || fn.endsWith(".ics")) return part;
    for (const p of part.parts ?? []) { const r = find(p); if (r) return r; }
    return null;
  };
  const part = find(payload);
  if (!part) return "";
  if (part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  const attId = part.body?.attachmentId;
  if (attId) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${attId}`, { headers: auth }).catch(() => null);
    if (res?.ok) {
      const d = await res.json().catch(() => ({} as { data?: string }));
      if (d.data) return Buffer.from(d.data, "base64url").toString("utf8");
    }
  }
  return "";
}

/** MIME 트리에서 text/plain(없으면 text/html 태그제거) 본문 추출. base64url 디코드. */
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const decode = (d?: string) => (d ? Buffer.from(d, "base64url").toString("utf8") : "");
  const find = (part: GmailPart, mime: string): string => {
    if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
    for (const p of part.parts ?? []) {
      const r = find(p, mime);
      if (r) return r;
    }
    return "";
  };
  const plain = find(payload, "text/plain");
  if (plain) return plain;
  const html = find(payload, "text/html");
  return html ? html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

/** 한 사서함(owner) 최근 메일 전체 수집 → 매칭분은 브랜드 연결, 미매칭은 brand_id=null 로 적재. 반환 저장 건수. */
export async function syncMailbox(ownerEmail: string, maxResults = 100): Promise<number> {
  const token = await getAccessToken(ownerEmail);
  if (!token) return 0;
  const auth = { authorization: `Bearer ${token}` };

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent("newer_than:30d -in:spam -in:trash")}`,
    { headers: auth });
  if (!listRes.ok) return 0;
  const list = await listRes.json();
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);

  let saved = 0;
  for (const id of ids) {
    // format=full: 본문(회신 초안 근거) + 헤더 함께 수집.
    const mRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: auth });
    if (!mRes.ok) continue;
    const msg = await mRes.json();
    const headers: GmailHeader[] = msg.payload?.headers ?? [];
    const from = parseAddrs(headerVal(headers, "From"))[0] ?? "";
    const to = parseAddrs(headerVal(headers, "To"));
    const cc = parseAddrs(headerVal(headers, "Cc"));
    const subject = headerVal(headers, "Subject");
    const participants = [from, ...to, ...cc].filter(Boolean);

    // 이메일 캘린더 초대(ICS) 자동 맵핑 — 공용 메일함에 온 초대를 미팅 캘린더로.
    //   초대·참석자 정보를 미팅에 담아 표시(브랜드 미매칭이면 '매칭 필요'로 표시).
    try {
      const icsText = await extractCalendar(msg.payload, auth, id);
      if (icsText) {
        const { parseIcs } = await import("./ics");
        const ev = parseIcs(icsText);
        if (ev) {
          const { upsertCalendarMeeting } = await import("./meetings");
          await upsertCalendarMeeting(ev, { ownerEmail: ownerEmail.toLowerCase() });
        }
      }
    } catch { /* 초대 파싱 실패는 메일 수집에 영향 주지 않음 */ }

    // 공용 메일함은 모든 메일을 기본 수집 — 매칭되면 브랜드 연결, 미매칭이면 brand_id=null 로 저장(메일함에서 수동 연결).
    const match = await matchBrandByAddresses(participants);

    const owner = ownerEmail.toLowerCase();
    const direction: "in" | "out" = from === owner ? "out" : "in";
    const sentAt = new Date(Number(msg.internalDate ?? Date.now())).toISOString();

    const ok = await ingestEmailMessage(match?.brandId ?? null, {
      gmailMsgId: id, threadId: msg.threadId ?? id, direction,
      ownerEmail: owner, fromAddr: from, toAddrs: to,
      subject, snippet: (msg.snippet ?? "").slice(0, 300),
      bodyText: extractBody(msg.payload).slice(0, 8000) || undefined,
      hasAttachment: JSON.stringify(msg.payload ?? {}).includes("attachmentId"),
      sentAt,
    }).catch(() => false);
    if (ok) saved++;
  }
  return saved;
}

// ══════════════════════════════════════════════════════════════
// 발송/임시저장 (gmail.compose 위임) — 지정 공용 메일함 명의로.
// ══════════════════════════════════════════════════════════════

/** compose(발송/임시저장) 위임이 켜져 있는가 = 서비스계정 키 존재. */
export function gmailComposeEnabled(): boolean {
  return loadSaKey() !== null;
}

export interface OutAttachment { filename: string; content: string; mimeType?: string }  // content=base64
export interface OutMail {
  from: string;              // 발신 공용 메일함(예: cs@glovek.space) = impersonate 대상
  to: string;
  subject: string;
  bodyText: string;
  threadId?: string | null;  // Gmail 스레드에 이어붙이기(회신) — 있으면 같은 대화에 묶임
  inReplyTo?: string | null; // 원본 Message-ID (수신자 클라이언트 스레딩용, 선택)
  attachments?: OutAttachment[];  // ICS 초대 등 (multipart/mixed)
}

const b64wrap = (s: string) => s.replace(/(.{76})/g, "$1\r\n");

/** RFC 2822 MIME(UTF-8 base64) 생성 → Gmail API raw 필드용 base64url 문자열. */
function buildRawMessage(m: OutMail): string {
  const encWord = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const top: string[] = [`From: ${m.from}`, `To: ${m.to}`, `Subject: ${encWord(m.subject)}`, "MIME-Version: 1.0"];
  if (m.inReplyTo) top.push(`In-Reply-To: ${m.inReplyTo}`, `References: ${m.inReplyTo}`);

  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64wrap(Buffer.from(m.bodyText, "utf8").toString("base64")),
  ].join("\r\n");

  let raw: string;
  if (m.attachments?.length) {
    const boundary = "gk_" + Buffer.from(m.subject + m.to).toString("base64url").slice(0, 16);
    const parts = [`--${boundary}`, textPart];
    for (const a of m.attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${a.mimeType ?? "application/octet-stream"}; name="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "",
        b64wrap(a.content),
      );
    }
    parts.push(`--${boundary}--`);
    raw = [...top, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", parts.join("\r\n")].join("\r\n");
  } else {
    raw = [...top, textPart].join("\r\n");
  }
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** 지정 메일함(from) 명의로 즉시 발송. 성공 시 {id, threadId}. */
export async function sendGmailMessage(m: OutMail): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const token = await getAccessToken(m.from.toLowerCase(), SCOPE_COMPOSE);
  if (!token) return { ok: false, error: "Gmail 위임 미설정(GOOGLE_SA_KEY_JSON·gmail.compose 스코프)" };
  const raw = buildRawMessage(m);
  const post = (withThread: boolean) => fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(withThread && m.threadId ? { raw, threadId: m.threadId } : { raw }) });
  let res = await post(true);
  // threadId 불일치(제목 미매칭 등)로 실패하면 스레드 없이 재시도.
  if (!res.ok && m.threadId) res = await post(false);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (data as { error?: { message?: string } }).error?.message ?? "발송 실패" };
  return { ok: true, id: (data as { id?: string }).id, threadId: (data as { threadId?: string }).threadId };
}

/** 지정 메일함(from)의 Gmail 임시보관함에 초안 저장 → 담당자가 Gmail 에서 마저 발송. */
export async function createGmailDraft(m: OutMail): Promise<{ ok: boolean; draftId?: string; error?: string }> {
  const token = await getAccessToken(m.from.toLowerCase(), SCOPE_COMPOSE);
  if (!token) return { ok: false, error: "Gmail 위임 미설정(GOOGLE_SA_KEY_JSON·gmail.compose 스코프)" };
  const raw = buildRawMessage(m);
  const message = m.threadId ? { raw, threadId: m.threadId } : { raw };
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (data as { error?: { message?: string } }).error?.message ?? "임시저장 실패" };
  return { ok: true, draftId: (data as { id?: string }).id };
}

/** sync 대상 순회: 회사 공용 메일함(shared_mailboxes) + (레거시) admin_users.gmail_sync_enabled. */
export async function syncAllMailboxes(): Promise<{ accounts: number; saved: number }> {
  if (!loadSaKey()) return { accounts: 0, saved: 0 };
  const { enabledMailboxes, markSynced } = await import("./shared-mailboxes");
  const shared = await enabledMailboxes();
  const legacy = await query<{ id: string }>(
    "SELECT id FROM admin_users WHERE gmail_sync_enabled = true").catch(() => []);

  // 주소 집합(중복 제거) — 공용 메일함 우선
  const addrs = new Set<string>();
  for (const s of shared) if (s.email.includes("@")) addrs.add(s.email.toLowerCase());
  for (const a of legacy) if (a.id?.includes("@")) addrs.add(a.id.toLowerCase());

  let saved = 0, n = 0;
  for (const addr of addrs) {
    saved += await syncMailbox(addr).catch(() => 0);
    if (shared.some((s) => s.email.toLowerCase() === addr)) await markSynced(addr);
    n++;
  }
  return { accounts: n, saved };
}
