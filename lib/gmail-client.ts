// Gmail 도메인 위임 수집 (09-A) — 서비스계정 JWT + Gmail REST (googleapis 의존성 없이).
//   env GOOGLE_SA_KEY_JSON = 서비스계정 키 JSON({client_email, private_key}).
//   각 admin_users.gmail_sync_enabled 계정을 impersonate 해 최근 메일을 브랜드 매칭 후 적재.
import crypto from "node:crypto";
import { env } from "./env";
import { query } from "./db";
import { matchBrandByAddresses, ingestEmailMessage } from "./email-sync";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
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

/** 서비스계정 → 특정 사용자(sub) impersonate 액세스 토큰. */
async function getAccessToken(sub: string): Promise<string | null> {
  const sa = loadSaKey();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, sub, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600,
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

interface GmailPart { mimeType?: string; body?: { data?: string; size?: number }; parts?: GmailPart[] }

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

/** 한 사서함(owner) 최근 메일 수집 → 브랜드 매칭분만 적재. 반환 저장 건수. */
export async function syncMailbox(ownerEmail: string, maxResults = 30): Promise<number> {
  const token = await getAccessToken(ownerEmail);
  if (!token) return 0;
  const auth = { authorization: `Bearer ${token}` };

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent("newer_than:14d -in:spam -in:trash")}`,
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

    // 브랜드 매칭 메일만 (프라이버시 — 미매칭 폐기)
    const match = await matchBrandByAddresses(participants);
    if (!match) continue;

    const owner = ownerEmail.toLowerCase();
    const direction: "in" | "out" = from === owner ? "out" : "in";
    const sentAt = new Date(Number(msg.internalDate ?? Date.now())).toISOString();

    const ok = await ingestEmailMessage(match.brandId, {
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
