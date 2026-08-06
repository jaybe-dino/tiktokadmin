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

// CSV 매핑 UI 대상 필드(라벨) — target field → 한글 라벨.
export const IMPORT_TARGETS: { key: string; label: string; group: RegExp[] | null }[] = [
  { key: "brand_name", label: "브랜드명", group: FIELD_RE.brand },
  { key: "email", label: "이메일", group: FIELD_RE.email },
  { key: "phone", label: "전화번호", group: FIELD_RE.phone },
  { key: "contact_name", label: "담당자명", group: FIELD_RE.contact },
  { key: "biz_no", label: "사업자번호", group: FIELD_RE.biz_no },
  { key: "category", label: "카테고리", group: FIELD_RE.category },
  { key: "brand_url", label: "판매채널 URL", group: FIELD_RE.url },
  { key: "memo", label: "메모", group: FIELD_RE.message },
];

/** 헤더 목록 → 자동 감지된 매핑(target → header). UI 프리필용. */
export function detectHeaderMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const t of IMPORT_TARGETS) {
    if (!t.group) continue;
    for (const re of t.group) {
      const h = headers.find((x) => re.test(x));
      if (h) { map[t.key] = h; break; }
    }
  }
  return map;
}

/** 명시 컬럼맵(target→header)으로 한 행을 ImportRecord 로. 비매핑 필드는 자동감지 폴백. */
export function recordFromMap(row: Record<string, string>, columnMap: Record<string, string>): ImportRecord {
  const auto = detectImportRecord(row);
  const g = (k: keyof ImportRecord): string | undefined => {
    const h = columnMap[k as string];
    if (h && row[h]?.trim()) return row[h].trim();
    return auto[k] as string | undefined;
  };
  return {
    ...auto,
    email: g("email"), phone: g("phone"), biz_no: g("biz_no"),
    brand_name: g("brand_name"), contact_name: g("contact_name"),
    category: g("category"), brand_url: g("brand_url"), memo: g("memo"),
  };
}

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
