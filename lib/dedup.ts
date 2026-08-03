import type { PoolClient } from "pg";
import type { Brand } from "./types";

// dedup(통합 키) — 순서 고정 (00-MASTER-PLAN 4-3, 01 §2).
//   email(소문자) → phone(숫자만) → biz_no(숫자만) → brand_name + brand_url(호스트 동일)

export function normalizeEmail(v?: string | null): string | null {
  const e = (v ?? "").trim().toLowerCase();
  return e || null;
}

export function normalizePhone(v?: string | null): string | null {
  const p = (v ?? "").replace(/\D/g, "");
  return p || null;
}

export function normalizeBizNo(v?: string | null): string | null {
  const b = (v ?? "").replace(/\D/g, "");
  return b || null;
}

/** URL 에서 호스트만 소문자로 추출 (www. 제거). 비교용. */
export function urlHost(v?: string | null): string | null {
  const raw = (v ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.replace(/^www\./, "").toLowerCase() || null;
  }
}

export interface DedupKeys {
  email: string | null;
  phone: string | null;
  biz_no: string | null;
  brand_name: string;
  brand_url: string;
}

export function extractKeys(p: {
  email?: string | null;
  phone?: string | null;
  biz_no?: string | null;
  brand_name?: string | null;
  brand_url?: string | null;
}): DedupKeys {
  return {
    email: normalizeEmail(p.email),
    phone: normalizePhone(p.phone),
    biz_no: normalizeBizNo(p.biz_no),
    brand_name: (p.brand_name ?? "").trim(),
    brand_url: (p.brand_url ?? "").trim(),
  };
}

/** dedup 최소요건: email/phone/biz_no 중 최소 하나. */
export function hasDedupKey(k: DedupKeys): boolean {
  return Boolean(k.email || k.phone || k.biz_no);
}

/**
 * 우선순위대로 기존 brands 행을 찾는다. 없으면 null.
 * client 를 받아 트랜잭션 내에서 사용 (FOR UPDATE 잠금).
 */
export async function findBrand(client: PoolClient, k: DedupKeys): Promise<Brand | null> {
  // 1) email (brands.email)
  if (k.email) {
    const r = await client.query<Brand>(
      "SELECT * FROM brands WHERE email = $1 LIMIT 1 FOR UPDATE",
      [k.email],
    );
    if (r.rows[0]) return r.rows[0];
    // 1-b) email 별칭(brand_email_aliases) — 보조 이메일로 온 리드도 기존 브랜드에 병합.
    //   (email-sync 매칭 우선순위와 정합 유지 — 미적용 시 중복 브랜드 생성)
    const a = await client.query<Brand>(
      `SELECT b.* FROM brands b JOIN brand_email_aliases e ON e.brand_id=b.id
        WHERE lower(e.email)=lower($1) LIMIT 1 FOR UPDATE OF b`,
      [k.email],
    ).catch(() => ({ rows: [] as Brand[] }));
    if (a.rows[0]) return a.rows[0];
  }
  // 2) phone
  if (k.phone) {
    const r = await client.query<Brand>(
      "SELECT * FROM brands WHERE phone = $1 LIMIT 1 FOR UPDATE",
      [k.phone],
    );
    if (r.rows[0]) return r.rows[0];
  }
  // 3) biz_no
  if (k.biz_no) {
    const r = await client.query<Brand>(
      "SELECT * FROM brands WHERE biz_no = $1 LIMIT 1 FOR UPDATE",
      [k.biz_no],
    );
    if (r.rows[0]) return r.rows[0];
  }
  // 4) brand_name(정확) AND brand_url(호스트 동일)
  const host = urlHost(k.brand_url);
  if (k.brand_name && host) {
    const r = await client.query<Brand>(
      `SELECT * FROM brands
         WHERE lower(brand_name) = lower($1)
           AND brand_url <> ''
         FOR UPDATE`,
      [k.brand_name],
    );
    const match = r.rows.find((b) => urlHost(b.brand_url) === host);
    if (match) return match;
  }
  return null;
}
