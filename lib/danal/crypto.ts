// Reused from EscapeMate bdcd31f011c619e1068e82c7fa390ef534b0de04; no live calls during development.
// Web Crypto helpers usable in Cloudflare Workers and Node 22 tests.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value.trim());
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** URL-safe random token. 32 bytes = 256 bits (≥128 bits required). */
export function randomToken(byteLength = 32): string {
  return base64UrlEncode(randomBytes(byteLength));
}

export function randomId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function hmacVerify(secret: string, message: string, signature: Uint8Array): Promise<boolean> {
  const key = await hmacKey(secret);
  return crypto.subtle.verify("HMAC", key, signature as BufferSource, encoder.encode(message));
}

/** Constant-time comparison for secrets of possibly different lengths. */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < va.length; i += 1) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/** Parses BILLING_KEY_ENCRYPTION_KEY: base64 (or base64url) encoding of exactly 32 bytes. */
export function parseEncryptionKey(value: string | undefined | null): Uint8Array | null {
  if (!value) return null;
  try {
    const bytes = /[-_]/.test(value) ? base64UrlDecode(value.trim()) : base64Decode(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM. Output: "v1.<iv>.<ciphertext+tag>" (base64url). `aad` binds the ciphertext to its row. */
export async function encryptSecret(raw: Uint8Array, plaintext: string, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: encoder.encode(aad) },
    await aesKey(raw),
    encoder.encode(plaintext),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(raw: Uint8Array, payload: string, aad: string): Promise<string> {
  const [version, ivPart, dataPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !dataPart) throw new Error("unsupported ciphertext");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(ivPart) as BufferSource, additionalData: encoder.encode(aad) },
    await aesKey(raw),
    base64UrlDecode(dataPart) as BufferSource,
  );
  return decoder.decode(plaintext);
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
