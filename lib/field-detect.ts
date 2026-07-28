import type { ImportRecord } from "./import";

// 컬럼명 패턴 매칭 — 어떤 소스의 임의 헤더에서도 표준 필드를 뽑는다.
// backfill(glovek DB) 과 CSV import 가 공유.

export const FIELD_RE = {
  email: [/^email$/i, /email/i, /mail/i],
  phone: [/^phone$/i, /phone/i, /mobile/i, /^tel$/i, /연락처/, /휴대/],
  biz_no: [/^biz_?no$/i, /company_reg/i, /business_?(no|number)/i, /사업자/],
  brand: [/^brand_?name$/i, /brand/i, /company_?name/i, /^company$/i, /shop_?name/i, /store_?name/i, /브랜드/, /상호/, /회사/],
  contact: [/^contact_?name$/i, /contact_?name/i, /^name$/i, /담당/, /manager/i, /이름/, /성함/],
  category: [/category/i, /업종/, /카테고리/, /industry/i],
  url: [/brand_?url/i, /sales_?channel/i, /store_?url/i, /url/i, /link/i, /사이트/, /주소/],
  message: [/message/i, /inquiry/i, /content/i, /문의/, /note/i, /비고/],
  grade: [/^grade$/i, /grade/i, /등급/],
  rec_track: [/recommended?_?track/i, /rec_?track/i, /track/i, /트랙/],
  status: [/^status$/i, /sub.*status/i, /status/i, /상태/],
  userId: [/^user_?id$/i, /user_?id/i],
  id: [/^id$/i],
};

/** 우선순위 패턴군에서 첫 non-empty 값. */
export function pick(row: Record<string, unknown>, groups: RegExp[]): string | undefined {
  for (const re of groups) {
    for (const k of Object.keys(row)) {
      if (re.test(k)) {
        const v = row[k];
        if (v != null && String(v).trim() !== "") return String(v).trim();
      }
    }
  }
  return undefined;
}

/** 정확 컬럼명 우선(여러 후보), 없으면 undefined. */
function exact(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) if (row[k]?.trim()) return row[k].trim();
  return undefined;
}

/**
 * CSV 한 행 → ImportRecord.
 *  · 식별/기본 필드는 퍼지 매칭(어떤 헤더든 인식)
 *  · enum/메타 필드는 정확 컬럼명만(오탐 방지)
 */
export function detectImportRecord(row: Record<string, string>): ImportRecord {
  return {
    email: pick(row, FIELD_RE.email),
    phone: pick(row, FIELD_RE.phone),
    biz_no: pick(row, FIELD_RE.biz_no),
    brand_name: pick(row, FIELD_RE.brand),
    contact_name: pick(row, FIELD_RE.contact),
    category: pick(row, FIELD_RE.category),
    brand_url: pick(row, FIELD_RE.url),
    memo: exact(row, "memo", "메모") ?? pick(row, FIELD_RE.message),
    // enum/메타 — 정확 컬럼명
    source: exact(row, "source"),
    state: exact(row, "state", "단계"),
    grade: exact(row, "grade", "등급"),
    plan: exact(row, "plan", "플랜"),
    contract_type: exact(row, "contract_type", "계약형태"),
    pay_status: exact(row, "pay_status", "결제상태"),
    rec_track: exact(row, "rec_track"),
    owner_intake: exact(row, "owner_intake"),
    owner_sales: exact(row, "owner_sales"),
    owner_onboard: exact(row, "owner_onboard"),
    owner_ads: exact(row, "owner_ads"),
    next_action: exact(row, "next_action", "다음액션"),
    due_date: exact(row, "due_date"),
    countries: exact(row, "countries", "국가"),
  };
}
