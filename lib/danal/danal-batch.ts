// Reused from EscapeMate bdcd31f011c619e1068e82c7fa390ef534b0de04; no live calls during development.
// Danal legacy CPID credit-card BATCH (정기결제) protocol — DanalCreditRebill
// Manual 1.0.32 (official, received 2025-11-17). Protocol evidence only: it is
// NOT evidence that this merchant is approved for BATCH or that a server IP is
// registered. Every request goes through the fixed-egress relay
// (services/danal-relay); this module never talks to Danal directly.
//
// Wire format (manual "암호화 규칙"):
//   request body  = CPID=<cpid>&DATA=URLEncode(Base64(AES256(k=URLEncode(v)&…)))
//   response/NOTI = DATA=<same construction>; decrypted NameValuePairs, order not guaranteed
//   URLEncode characterset is EUC-KR (Java URLEncoder). AES = AES/CBC/PKCS5Padding,
//   key = hex(CRYPTOKEY, 64 chars → 32 bytes), IV = hex(IVKEY, 32 chars → 16 bytes).
// To avoid guessing an EUC-KR mapping, this adapter only ever SENDS printable
// ASCII values (where EUC-KR and ASCII percent-encoding are byte-identical) and
// rejects the characters the manual forbids: & ' " \ < > | , + and newlines.
import { base64UrlEncode, hmacSha256, sha256Hex, timingSafeEqualString } from "./crypto";
import { isAllowedDanalStartUrl } from "./danal-start-url";

/** Fixed Danal credit endpoint (manual "Danal Server"). The relay forwards only here. */
export const DANAL_CREDIT_URL = "https://tx-creditcard.danalpay.com/credit/";
export const RETURNCODE_SUCCESS = "0000";
export const CURRENCY_KRW = "410";

export type BatchKeys = { cpid: string; key: Uint8Array; iv: Uint8Array };

export type BatchOperation = "AUTH" | "ISSUEBILLKEY" | "OTBILL" | "DELBILLKEY" | "CANCEL";

const FORBIDDEN = /[&'"\\<>|,+\r\n]/;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

export function hexToBytes(hex: string, expectedBytes: number): Uint8Array | null {
  if (typeof hex !== "string" || hex.length !== expectedBytes * 2 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function parseBatchKeys(cpid: string | undefined, cryptoKeyHex: string | undefined, ivHex: string | undefined): BatchKeys | null {
  const id = cpid?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{1,10}$/.test(id)) return null; // CPID: 10 bytes (manual)
  const key = hexToBytes(cryptoKeyHex?.trim() ?? "", 32);
  const iv = hexToBytes(ivHex?.trim() ?? "", 16);
  return key && iv ? { cpid: id, key, iv } : null;
}

/** Java URLEncoder semantics for printable ASCII: [A-Za-z0-9.-*_] kept, space → '+', others %XX. */
export function formEncode(value: string): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9.\-*_]/.test(ch)) out += ch;
    else if (ch === " ") out += "+";
    else out += `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function decodeBytes(bytes: number[]): string {
  const data = new Uint8Array(bytes);
  if (bytes.every((b) => b < 0x80)) return String.fromCharCode(...data);
  try {
    // Display-only fields (e.g. RETURNMSG) may be Korean EUC-KR; never used for decisions.
    return new TextDecoder("euc-kr").decode(data);
  } catch {
    return String.fromCharCode(...data.map((b) => (b < 0x80 ? b : 0x3f)));
  }
}

/** URLDecoder semantics ('+' → space, %XX bytes decoded as EUC-KR). Returns null on malformed escapes. */
export function formDecode(value: string): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "+") bytes.push(0x20);
    else if (ch === "%") {
      const hex = value.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      const code = ch.charCodeAt(0);
      if (code > 0x7e || code < 0x20) return null;
      bytes.push(code);
    }
  }
  return decodeBytes(bytes);
}

/** Validates a value against the manual's special-character rule and a byte limit. */
export function safeValue(value: string, maxBytes: number): boolean {
  return typeof value === "string" && PRINTABLE_ASCII.test(value) && !FORBIDDEN.test(value) && value.length <= maxBytes;
}

export function buildQuery(fields: [string, string][]): string {
  return fields.map(([k, v]) => `${k}=${formEncode(v)}`).join("&");
}

/** Parses NameValuePairs by name (order not guaranteed). Duplicate or malformed pairs → null. */
export function parsePairs(text: string): Map<string, string> | null {
  const map = new Map<string, string>();
  if (!text) return map;
  for (const part of text.split("&")) {
    if (!part) continue;
    const index = part.indexOf("=");
    if (index <= 0) return null;
    const name = part.slice(0, index);
    if (!/^[A-Za-z0-9_]{1,40}$/.test(name) || map.has(name)) return null;
    const value = formDecode(part.slice(index + 1));
    if (value === null) return null;
    map.set(name, value);
  }
  return map;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const s = atob(value);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function aesKey(keys: BatchKeys, usage: "encrypt" | "decrypt") {
  return crypto.subtle.importKey("raw", keys.key as BufferSource, { name: "AES-CBC" }, false, [usage]);
}

/** Base64(AES-256-CBC-PKCS#7(plaintext)) — identical to the reference toEncrypt(). */
export async function encryptData(keys: BatchKeys, plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-CBC", iv: keys.iv as BufferSource }, await aesKey(keys, "encrypt"), data);
  return toBase64(new Uint8Array(cipher));
}

/** Inverse of encryptData; null on any failure (bad base64, padding, length). */
export async function decryptData(keys: BatchKeys, base64: string): Promise<string | null> {
  const bytes = fromBase64(base64.replace(/ /g, "+"));
  if (!bytes || bytes.length === 0 || bytes.length % 16 !== 0 || bytes.length > 16384) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: keys.iv as BufferSource }, await aesKey(keys, "decrypt"), bytes as BufferSource);
    const out = new Uint8Array(plain);
    for (const b of out) if (b < 0x20 || b > 0x7e) return null; // the inner querystring is URL-encoded ASCII
    return String.fromCharCode(...out);
  } catch {
    return null;
  }
}

/** Builds the exact request body forwarded to Danal: CPID=…&DATA=… */
export async function encodeRequest(keys: BatchKeys, fields: [string, string][]): Promise<string> {
  const plaintext = buildQuery(fields);
  return `CPID=${formEncode(keys.cpid)}&DATA=${formEncode(await encryptData(keys, plaintext))}`;
}

/** Decrypts an encrypted DATA value (response, RETURNPARAMS or NOTI) into named fields. */
export async function decodeEncrypted(keys: BatchKeys, encrypted: string): Promise<Map<string, string> | null> {
  const plain = await decryptData(keys, encrypted);
  return plain === null ? null : parsePairs(plain);
}

/** Decodes a provider response body ("DATA=…"). Bodies without DATA are not interpreted. */
export async function decodeResponseBody(keys: BatchKeys, body: string): Promise<Map<string, string> | null> {
  const outer = parsePairs(body.trim());
  const data = outer?.get("DATA");
  if (!data) return null;
  return decodeEncrypted(keys, data);
}

// ---------------------------------------------------------------- requests

export type AuthRequest = {
  orderId: string;
  itemName: string;
  amount: number;
  userId: string;
  userAgent: "PC" | "MW";
  returnUrl: string;
  cancelUrl: string;
  notiUrl: string | null;
};

function amountText(amount: number, min: number): string {
  if (!Number.isSafeInteger(amount) || amount < min || amount > 99_999_999_999) throw new Error("INVALID_AMOUNT");
  return String(amount);
}

function need(value: string, max: number, name: string): string {
  if (!value || !safeValue(value, max)) throw new Error(`INVALID_FIELD_${name}`);
  return value;
}

/** AUTH / SERVICETYPE=BATCH / ISBILL=Y — the first month is charged later by ISSUEBILLKEY. */
export function authFields(input: AuthRequest): [string, string][] {
  const fields: [string, string][] = [
    ["TXTYPE", "AUTH"],
    ["SERVICETYPE", "BATCH"],
    ["ORDERID", need(input.orderId, 255, "ORDERID")],
    ["ITEMNAME", need(input.itemName, 255, "ITEMNAME")],
    ["AMOUNT", amountText(input.amount, 100)],
    ["CURRENCY", CURRENCY_KRW],
    ["USERID", need(input.userId, 128, "USERID")],
    ["USERAGENT", input.userAgent === "MW" ? "MW" : "PC"],
    ["ISBILL", "Y"], // never N: a 100 KRW auth (ISBILL=N) must never grant paid access
    ["RETURNURL", need(input.returnUrl, 255, "RETURNURL")],
    ["CANCELURL", need(input.cancelUrl, 255, "CANCELURL")],
    ["ISNOTI", input.notiUrl ? "Y" : "N"],
  ];
  if (input.notiUrl) fields.push(["NOTIURL", need(input.notiUrl, 255, "NOTIURL")]);
  return fields;
}

/**
 * Registration-only AUTH (manual 1.0.32): SERVICETYPE=BATCH, ISBILL=N, AMOUNT=100. Used
 * ONLY by the owner recurring validation (recurring-validation.ts); it never creates an
 * order, subscription or access. Danal approves a temporary 100 KRW at ISSUEBILLKEY and
 * cancels it automatically. The special AMOUNT=0 mode (+ DISABLEAMOUNTUI) is NOT used:
 * this merchant's ISSUEBILLKEY rejected it live (RETURNCODE 3214, "0원 거래 불가").
 */
/** The temporary registration approval (auto-cancelled by Danal; never assumed cancelled here). */
export const REGISTRATION_AMOUNT = 100;

export function registrationAuthFields(input: Omit<AuthRequest, "amount" | "notiUrl">): [string, string][] {
  return [
    ["TXTYPE", "AUTH"],
    ["SERVICETYPE", "BATCH"],
    ["ORDERID", need(input.orderId, 255, "ORDERID")],
    ["ITEMNAME", need(input.itemName, 255, "ITEMNAME")],
    ["AMOUNT", String(REGISTRATION_AMOUNT)],
    ["CURRENCY", CURRENCY_KRW],
    ["USERID", need(input.userId, 128, "USERID")],
    ["USERAGENT", input.userAgent === "MW" ? "MW" : "PC"],
    ["ISBILL", "N"],
    ["RETURNURL", need(input.returnUrl, 255, "RETURNURL")],
    ["CANCELURL", need(input.cancelUrl, 255, "CANCELURL")],
    ["ISNOTI", "N"],
  ];
}

/** ISSUEBILLKEY after an ISBILL=N AUTH: AMOUNT is omitted (the provider approves 100 KRW itself). */
export function registrationIssueBillKeyFields(input: { tid: string }): [string, string][] {
  return [
    ["TXTYPE", "ISSUEBILLKEY"],
    ["SERVICETYPE", "BATCH"],
    ["TID", need(input.tid, 64, "TID")],
  ];
}

export function issueBillKeyFields(input: { tid: string; amount: number }): [string, string][] {
  return [
    ["TXTYPE", "ISSUEBILLKEY"],
    ["SERVICETYPE", "BATCH"],
    ["TID", need(input.tid, 64, "TID")],
    ["AMOUNT", amountText(input.amount, 100)], // ISBILL=Y: same amount as AUTH
  ];
}

export function otbillFields(input: { orderId: string; itemName: string; amount: number; userId: string; billKey: string }): [string, string][] {
  return [
    ["TXTYPE", "OTBILL"],
    ["SERVICETYPE", "BATCH"],
    ["ORDERID", need(input.orderId, 255, "ORDERID")],
    ["ITEMNAME", need(input.itemName, 255, "ITEMNAME")],
    ["AMOUNT", amountText(input.amount, 301)],
    ["CURRENCY", CURRENCY_KRW],
    ["USERID", need(input.userId, 128, "USERID")],
    ["USERAGENT", "ONLINE"],
    ["ISREBILL", "Y"],
    ["BILLINFO", need(input.billKey, 255, "BILLINFO")],
  ];
}

export function delBillKeyFields(input: { billKey: string }): [string, string][] {
  return [
    ["TXTYPE", "DELBILLKEY"],
    ["SERVICETYPE", "BATCH"],
    ["BILLKEY", need(input.billKey, 255, "BILLKEY")],
  ];
}

export function cancelFields(input: { tid: string; amount: number; cancelType: "C" | "P"; requester: string; reason: string }): [string, string][] {
  if (input.cancelType !== "C" && input.cancelType !== "P") throw new Error("INVALID_CANCELTYPE");
  const fields: [string, string][] = [
    ["TXTYPE", "CANCEL"],
    ["SERVICETYPE", "DANALCARD"],
    ["TID", need(input.tid, 64, "TID")],
    ["AMOUNT", amountText(input.amount, 1)],
    ["CANCELTYPE", input.cancelType],
  ];
  if (input.requester) fields.push(["CANCELREQUESTER", need(input.requester, 20, "CANCELREQUESTER")]);
  if (input.reason) fields.push(["CANCELDESC", need(input.reason, 255, "CANCELDESC")]);
  return fields;
}

// ---------------------------------------------------------------- verification

export type BatchOutcome<T> =
  | { kind: "success"; data: T }
  | { kind: "failed"; code: string; message: string }
  | { kind: "unknown"; reason: string };

const TID_RE = /^[A-Za-z0-9]{1,64}$/;

function code(fields: Map<string, string>): string | null {
  const value = fields.get("RETURNCODE");
  return value && /^[A-Za-z0-9]{1,8}$/.test(value) ? value : null;
}

function declined(fields: Map<string, string>): BatchOutcome<never> | null {
  const c = code(fields);
  if (c && c !== RETURNCODE_SUCCESS) {
    return { kind: "failed", code: c, message: (fields.get("RETURNMSG") ?? "").replace(/[\r\n\t<>]/g, " ").slice(0, 200) };
  }
  return null;
}

function amountEquals(value: string | undefined, expected: number): boolean {
  return typeof value === "string" && /^\d{1,11}$/.test(value) && Number(value) === expected;
}

export type AuthResult = { tid: string; startUrl: string; startParams: string };

/** AUTH response: STARTURL must pass the shared allow-list (danal-start-url.ts); mismatched ORDERID/AMOUNT are refused. */
export function verifyAuth(fields: Map<string, string> | null, expected: { orderId: string; amount: number }): BatchOutcome<AuthResult> {
  if (!fields) return { kind: "unknown", reason: "UNREADABLE_RESPONSE" };
  const rejected = declined(fields);
  if (rejected) return rejected;
  if (code(fields) !== RETURNCODE_SUCCESS) return { kind: "unknown", reason: "NO_RETURNCODE" };
  const tid = fields.get("TID") ?? "";
  const startUrl = fields.get("STARTURL") ?? "";
  const startParams = fields.get("STARTPARAMS") ?? "";
  const urlOk = isAllowedDanalStartUrl(startUrl);
  if (!TID_RE.test(tid) || !urlOk || !startParams || startParams.length > 8192) return { kind: "unknown", reason: "AUTH_INCOMPLETE" };
  if (fields.has("ORDERID") && fields.get("ORDERID") !== expected.orderId) return { kind: "unknown", reason: "AUTH_ORDER_MISMATCH" };
  if (fields.has("AMOUNT") && !amountEquals(fields.get("AMOUNT"), expected.amount)) return { kind: "unknown", reason: "AUTH_AMOUNT_MISMATCH" };
  return { kind: "success", data: { tid, startUrl, startParams } };
}

/** Browser-delivered RETURNPARAMS: only tells us whether to ask the server (ISSUEBILLKEY). Never proof of payment. */
export function readReturnParams(fields: Map<string, string> | null): { tid: string; returnCode: string; orderId: string | null } | null {
  if (!fields) return null;
  const tid = fields.get("TID") ?? "";
  const returnCode = code(fields);
  if (!TID_RE.test(tid) || !returnCode) return null;
  return { tid, returnCode, orderId: fields.get("ORDERID") ?? null };
}

export type IssueBillKeyResult = { tid: string; billKey: string; amount: number; orderId: string };

/**
 * ISSUEBILLKEY (ISBILL=Y) charges the first month and returns the billing key.
 * Success requires RETURNCODE=0000 AND exact TID, ORDERID, AMOUNT, ISBILL=Y and a
 * BILLKEY. A 0000 with anything missing or different is UNKNOWN (money may have moved).
 */
export function verifyIssueBillKey(
  fields: Map<string, string> | null,
  expected: { tid: string; orderId: string; amount: number },
): BatchOutcome<IssueBillKeyResult> {
  if (!fields) return { kind: "unknown", reason: "UNREADABLE_RESPONSE" };
  const rejected = declined(fields);
  if (rejected) return rejected;
  if (code(fields) !== RETURNCODE_SUCCESS) return { kind: "unknown", reason: "NO_RETURNCODE" };
  const billKey = fields.get("BILLKEY") ?? "";
  if (fields.get("TID") !== expected.tid) return { kind: "unknown", reason: "ISSUE_TID_MISMATCH" };
  if (fields.get("ISBILL") !== "Y") return { kind: "unknown", reason: "ISSUE_NOT_ISBILL_Y" };
  if (!amountEquals(fields.get("AMOUNT"), expected.amount)) return { kind: "unknown", reason: "ISSUE_AMOUNT_MISMATCH" };
  if (fields.get("ORDERID") !== expected.orderId) return { kind: "unknown", reason: "ISSUE_ORDER_MISMATCH" };
  if (!billKey || billKey.length > 255 || !safeValue(billKey, 255)) return { kind: "unknown", reason: "ISSUE_NO_BILLKEY" };
  return { kind: "success", data: { tid: expected.tid, billKey, amount: expected.amount, orderId: expected.orderId } };
}

export type RegistrationResult = { billKey: string; reportedAmount: 100 | null };

/**
 * ISSUEBILLKEY for a registration-only (ISBILL=N) AUTH. Success needs RETURNCODE=0000,
 * the exact stored TID, ISBILL=N, a BILLKEY, and — only when present — the same ORDERID
 * and an AMOUNT of exactly 100. Anything else after 0000 (including AMOUNT=0) is UNKNOWN (an ISBILL=Y would mean
 * a real charge). The temporary 100 KRW is reported, never assumed cancelled.
 */
export function verifyRegistrationIssueBillKey(fields: Map<string, string> | null, expected: { tid: string; orderId: string }): BatchOutcome<RegistrationResult> {
  if (!fields) return { kind: "unknown", reason: "UNREADABLE_RESPONSE" };
  const rejected = declined(fields);
  if (rejected) return rejected;
  if (code(fields) !== RETURNCODE_SUCCESS) return { kind: "unknown", reason: "NO_RETURNCODE" };
  if (fields.get("TID") !== expected.tid) return { kind: "unknown", reason: "REGISTER_TID_MISMATCH" };
  if (fields.get("ISBILL") !== "N") return { kind: "unknown", reason: "REGISTER_NOT_ISBILL_N" };
  if (fields.has("ORDERID") && fields.get("ORDERID") !== expected.orderId) return { kind: "unknown", reason: "REGISTER_ORDER_MISMATCH" };
  let reportedAmount: 100 | null = null;
  if (fields.has("AMOUNT")) {
    if (!amountEquals(fields.get("AMOUNT"), REGISTRATION_AMOUNT)) return { kind: "unknown", reason: "REGISTER_AMOUNT_UNEXPECTED" };
    reportedAmount = REGISTRATION_AMOUNT;
  }
  const billKey = fields.get("BILLKEY") ?? "";
  if (!billKey || billKey.length > 255 || !safeValue(billKey, 255)) return { kind: "unknown", reason: "REGISTER_NO_BILLKEY" };
  return { kind: "success", data: { billKey, reportedAmount } };
}

export type OtbillResult = { tid: string; amount: number; orderId: string };

/** OTBILL renewal: 0000 + same ORDERID + same full AMOUNT + a TID; otherwise UNKNOWN. */
export function verifyOtbill(fields: Map<string, string> | null, expected: { orderId: string; amount: number }): BatchOutcome<OtbillResult> {
  if (!fields) return { kind: "unknown", reason: "UNREADABLE_RESPONSE" };
  const rejected = declined(fields);
  if (rejected) return rejected;
  if (code(fields) !== RETURNCODE_SUCCESS) return { kind: "unknown", reason: "NO_RETURNCODE" };
  const tid = fields.get("TID") ?? "";
  if (!TID_RE.test(tid)) return { kind: "unknown", reason: "OTBILL_NO_TID" };
  if (fields.get("ORDERID") !== expected.orderId) return { kind: "unknown", reason: "OTBILL_ORDER_MISMATCH" };
  if (!amountEquals(fields.get("AMOUNT"), expected.amount)) return { kind: "unknown", reason: "OTBILL_AMOUNT_MISMATCH" };
  return { kind: "success", data: { tid, amount: expected.amount, orderId: expected.orderId } };
}

export function verifyDelBillKey(fields: Map<string, string> | null): BatchOutcome<true> {
  if (!fields) return { kind: "unknown", reason: "UNREADABLE_RESPONSE" };
  const rejected = declined(fields);
  if (rejected) return rejected;
  return code(fields) === RETURNCODE_SUCCESS ? { kind: "success", data: true } : { kind: "unknown", reason: "NO_RETURNCODE" };
}

export function verifyCancel(fields: Map<string, string> | null, expected: { tid: string; amount: number }): BatchOutcome<{ cancelTid: string | null }> {
  if (!fields) return { kind: "unknown", reason: "UNREADABLE_RESPONSE" };
  const rejected = declined(fields);
  if (rejected) return rejected;
  if (code(fields) !== RETURNCODE_SUCCESS) return { kind: "unknown", reason: "NO_RETURNCODE" };
  if (fields.has("O_TID") && fields.get("O_TID") !== expected.tid) return { kind: "unknown", reason: "CANCEL_TID_MISMATCH" };
  if (fields.has("AMOUNT") && !amountEquals(fields.get("AMOUNT"), expected.amount)) return { kind: "unknown", reason: "CANCEL_AMOUNT_MISMATCH" };
  return { kind: "success", data: { cancelTid: fields.get("TID") ?? null } };
}

/** NOTI fields worth keeping as reconciliation evidence (never a grant by itself). */
export function readNoti(fields: Map<string, string> | null) {
  if (!fields) return null;
  const tid = fields.get("TID") ?? "";
  const returnCode = code(fields);
  if (!TID_RE.test(tid) || !returnCode) return null;
  return {
    tid,
    returnCode,
    orderId: fields.get("ORDERID") ?? null,
    amount: fields.get("AMOUNT") ?? null,
    isBill: fields.get("ISBILL") ?? null,
    billKey: fields.get("BILLKEY") ?? null,
  };
}

// ---------------------------------------------------------------- relay client

export type RelayConfig = { url: string; secret: string };
export type RelayTransport = (url: string, init: RequestInit) => Promise<Response>;

export const RELAY_PATH = "/v1/danal/credit";
export const RELAY_TIMEOUT_MS = 40_000;

/** Canonical string signed by both sides (see services/danal-relay/relay.mjs). */
export function relayCanonical(timestamp: string, nonce: string, method: string, path: string, bodyHash: string): string {
  return `danal-relay-v1\n${timestamp}\n${nonce}\n${method}\n${path}\n${bodyHash}`;
}

export function relayResponseCanonical(nonce: string, bodyHash: string): string {
  return `danal-relay-v1-response\n${nonce}\n${bodyHash}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  return [...(await hmacSha256(secret, message))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type RelayResult = { kind: "response"; httpStatus: number; body: string } | { kind: "unknown"; reason: string };

/**
 * Sends one already-encrypted Danal request through the relay. `idempotencyKey`
 * is durable on the relay: a repeat returns the stored outcome instead of
 * reaching Danal again. Any doubt is UNKNOWN (never "not charged").
 */
export async function relaySend(
  relay: RelayConfig,
  transport: RelayTransport,
  input: { operation: BatchOperation; idempotencyKey: string; body: string },
): Promise<RelayResult> {
  const payload = JSON.stringify({ operation: input.operation, idempotencyKey: input.idempotencyKey, body: input.body });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(18)));
  const signature = await hmacHex(relay.secret, relayCanonical(timestamp, nonce, "POST", RELAY_PATH, await sha256Hex(payload)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  try {
    const response = await transport(`${relay.url}${RELAY_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Timestamp": timestamp,
        "X-Relay-Nonce": nonce,
        "X-Relay-Signature": signature,
      },
      body: payload,
      signal: controller.signal,
    });
    const text = await response.text();
    const expected = await hmacHex(relay.secret, relayResponseCanonical(nonce, await sha256Hex(text)));
    if (!(await timingSafeEqualString(response.headers.get("X-Relay-Response-Signature") ?? "", expected))) {
      return { kind: "unknown", reason: "RELAY_RESPONSE_UNSIGNED" };
    }
    let parsed: { ok?: boolean; code?: string; httpStatus?: number; body?: string } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.ok !== true || typeof parsed.httpStatus !== "number" || typeof parsed.body !== "string") {
      return { kind: "unknown", reason: `RELAY_${typeof parsed?.code === "string" ? parsed.code.slice(0, 40) : `HTTP_${response.status}`}` };
    }
    return { kind: "response", httpStatus: parsed.httpStatus, body: parsed.body };
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error && error.name === "AbortError" ? "RELAY_TIMEOUT" : "RELAY_NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

/** Encrypts, relays and decrypts one operation. Non-200 provider HTTP is UNKNOWN. */
export async function batchCall(
  keys: BatchKeys,
  relay: RelayConfig,
  transport: RelayTransport,
  input: { operation: BatchOperation; idempotencyKey: string; fields: [string, string][] },
): Promise<{ fields: Map<string, string> | null } | { unknown: string }> {
  let body: string;
  try {
    body = await encodeRequest(keys, input.fields);
  } catch {
    return { unknown: "REQUEST_BUILD_FAILED" }; // nothing was sent
  }
  const sent = await relaySend(relay, transport, { operation: input.operation, idempotencyKey: input.idempotencyKey, body });
  if (sent.kind === "unknown") return { unknown: sent.reason };
  if (sent.httpStatus !== 200) return { unknown: `PROVIDER_HTTP_${sent.httpStatus}` };
  return { fields: await decodeResponseBody(keys, sent.body) };
}
