// 전역 검색 — 상단 검색창에서 이메일·회사명·대표자명·담당자 등으로 브랜드(원장)를 즉시 검색.
//   각 결과에 "어느 필드에서 매칭됐는지"(파트별 키워드)를 함께 반환해 어디에 데이터가 있는지 보여준다.
import { query } from "./db";

export interface SearchHit {
  brand_id: string;
  brand_name: string;
  state: string | null;
  matches: { label: string; value: string }[]; // 매칭된 필드(파트별 키워드)
}

type Row = {
  id: string; brand_name: string; state: string | null;
  email: string | null; phone: string | null;
  company_name_kr: string | null; company_name_en: string | null;
  rep_name: string | null; ubo_full_name: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  owner_names: string | null; contact_match: string | null;
};

// 필드 → 표시 라벨(파트 구분 포함).
const FIELD_LABELS: [keyof Row, string][] = [
  ["brand_name", "브랜드명"],
  ["company_name_kr", "회사명(한글)"],
  ["company_name_en", "회사명(영문)"],
  ["rep_name", "대표자"],
  ["ubo_full_name", "대표자(영문)"],
  ["contact_name", "담당자명(원장)"],
  ["email", "이메일"],
  ["contact_email", "이메일(원장)"],
  ["phone", "연락처"],
  ["contact_phone", "연락처(원장)"],
  ["owner_names", "담당자(우리팀)"],
  ["contact_match", "연락처 매칭"],
];

export async function globalSearch(q: string): Promise<SearchHit[]> {
  const term = (q || "").trim();
  if (term.length < 1) return [];
  const like = `%${term.replace(/[%_]/g, (m) => "\\" + m)}%`;
  const rows = await query<Row>(
    `SELECT b.id, b.brand_name, b.state, b.email, b.phone,
            bc.company_name_kr, bc.company_name_en, bc.rep_name, bc.ubo_full_name,
            bc.contact_name, bc.contact_email, bc.contact_phone,
            (SELECT string_agg(DISTINCT au.name, ', ') FROM admin_users au
              WHERE au.id IN (b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads)) AS owner_names,
            (SELECT ct.name || CASE WHEN ct.email IS NOT NULL AND ct.email <> '' THEN ' <'||ct.email||'>' ELSE '' END
               FROM brand_contacts ct WHERE ct.brand_id=b.id
                AND (ct.name ILIKE $1 OR ct.email ILIKE $1 OR ct.phone ILIKE $1) LIMIT 1) AS contact_match
       FROM brands b
       LEFT JOIN brand_company bc ON bc.brand_id = b.id
      WHERE b.brand_name ILIKE $1
         OR b.email ILIKE $1 OR b.phone ILIKE $1
         OR bc.company_name_kr ILIKE $1 OR bc.company_name_en ILIKE $1
         OR bc.rep_name ILIKE $1 OR bc.ubo_full_name ILIKE $1
         OR bc.contact_name ILIKE $1 OR bc.contact_email ILIKE $1 OR bc.contact_phone ILIKE $1
         OR EXISTS (SELECT 1 FROM brand_contacts ct WHERE ct.brand_id=b.id
                     AND (ct.name ILIKE $1 OR ct.email ILIKE $1 OR ct.phone ILIKE $1))
         OR EXISTS (SELECT 1 FROM admin_users au WHERE au.name ILIKE $1
                     AND au.id IN (b.owner_intake, b.owner_sales, b.owner_onboard, b.owner_ads))
      ORDER BY (b.brand_name ILIKE $1) DESC, b.updated_at DESC
      LIMIT 15`,
    [like],
  ).catch(() => [] as Row[]);

  const lc = term.toLowerCase();
  return rows.map((r) => {
    const matches: { label: string; value: string }[] = [];
    for (const [field, label] of FIELD_LABELS) {
      const v = r[field];
      if (v && String(v).toLowerCase().includes(lc)) matches.push({ label, value: String(v) });
    }
    return { brand_id: r.id, brand_name: r.brand_name, state: r.state, matches };
  });
}
