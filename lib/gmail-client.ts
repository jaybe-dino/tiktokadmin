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
    const mRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
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
      hasAttachment: JSON.stringify(msg.payload ?? {}).includes("attachmentId"),
      sentAt,
    }).catch(() => false);
    if (ok) saved++;
  }
  return saved;
}

/** sync 대상(gmail_sync_enabled) 전 계정 순회. */
export async function syncAllMailboxes(): Promise<{ accounts: number; saved: number }> {
  if (!loadSaKey()) return { accounts: 0, saved: 0 };
  const accounts = await query<{ id: string }>(
    "SELECT id FROM admin_users WHERE gmail_sync_enabled = true").catch(() => []);
  let saved = 0, n = 0;
  for (const a of accounts) {
    const addr = a.id; // admin_users.id = 회사 이메일(로그인 계정)
    if (!addr || !addr.includes("@")) continue;
    saved += await syncMailbox(addr).catch(() => 0);
    n++;
  }
  return { accounts: n, saved };
}
