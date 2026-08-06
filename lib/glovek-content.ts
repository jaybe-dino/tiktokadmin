// glovek.space 제품/콘텐츠 레퍼런스 조회(읽기전용) — 브랜드 카테고리·키워드로 "유사 제품 콘텐츠"를 찾는다.
//   ⚠️ glovek 의 products/videos/creators 는 크롤러 소유 테이블로 컬럼 스키마가 이 저장소에 문서화돼 있지 않다.
//   따라서 information_schema 로 컬럼을 런타임 introspect 하고, 이름 휴리스틱으로 존재하는 필드만 골라
//   동적 SELECT 를 구성한다(컬럼명은 information_schema 출처라 인젝션 안전). 스키마가 예상과 달라도
//   graceful 하게 빈 결과를 반환한다. 값 파라미터는 항상 바인딩($n)으로 처리.
import { queryRo } from "./db";

export interface GlovekContent {
  source: string;      // 'videos' | 'products'
  name?: string;
  brand?: string;
  category?: string;
  image_url?: string;
  link?: string;
  handle?: string;
  gmv?: string;
  views?: string;
}

// 테이블별 컬럼 캐시(요청 수명 내 재사용).
const colCache: Record<string, string[]> = {};
async function columnsOf(table: string): Promise<string[]> {
  if (colCache[table]) return colCache[table];
  const rows = await queryRo<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
    [table],
  ).catch(() => []);
  const cols = rows.map((r) => r.column_name);
  // 빈 결과(일시적 조회 실패/테이블 부재)는 캐시하지 않는다 — 프로세스 수명 동안 영구 비활성 방지.
  if (cols.length > 0) colCache[table] = cols;
  return cols;
}

const firstCol = (cols: string[], cands: string[]) => cands.find((c) => cols.includes(c));
const qid = (c: string) => `"${c.replace(/"/g, '""')}"`; // 식별자 인용

interface FieldMap { name?: string; brand?: string; category?: string; image?: string; link?: string; handle?: string; gmv?: string; views?: string }
function mapFields(cols: string[]): FieldMap {
  return {
    name: firstCol(cols, ["name", "title", "product_name", "product_title", "video_title", "caption", "desc", "description"]),
    brand: firstCol(cols, ["brand", "brand_name", "shop", "shop_name", "seller", "seller_name"]),
    category: firstCol(cols, ["category", "cat", "category_name", "type", "product_category"]),
    image: firstCol(cols, ["image_url", "image", "thumbnail", "thumb_url", "thumbnail_url", "cover", "cover_url", "main_image_url"]),
    link: firstCol(cols, ["url", "link", "product_url", "posted_url", "video_url", "permalink", "share_url"]),
    handle: firstCol(cols, ["handle", "creator_handle", "username", "author", "author_handle"]),
    gmv: firstCol(cols, ["gmv", "est_gmv", "revenue", "sales_amount"]), // 금액 컬럼만(판매수량 sold_count 등 제외)
    views: firstCol(cols, ["views", "view_count", "play_count", "plays", "likes", "like_count"]),
  };
}

// 한 테이블에서 키워드 매칭 콘텐츠 조회.
async function fromTable(table: string, keywords: string[], limit: number): Promise<GlovekContent[]> {
  const cols = await columnsOf(table);
  if (cols.length === 0) return [];
  const f = mapFields(cols);
  const selectable = Object.entries(f).filter(([, c]) => c) as [keyof FieldMap, string][];
  if (selectable.length === 0) return [];

  const selectList = selectable.map(([k, c]) => `${qid(c)} AS ${k}`).join(", ");
  // 키워드 필터: name/category/brand 컬럼에 ILIKE. 키워드 없으면 필터 없이 상위 정렬만.
  const searchCols = [f.category, f.name, f.brand].filter(Boolean) as string[];
  const params: unknown[] = [];
  let where = "";
  if (keywords.length > 0 && searchCols.length > 0) {
    const clauses: string[] = [];
    for (const kw of keywords.slice(0, 6)) {
      const p = `%${kw}%`;
      const per = searchCols.map((c) => { params.push(p); return `${qid(c)} ILIKE $${params.length}`; });
      clauses.push(`(${per.join(" OR ")})`);
    }
    where = `WHERE ${clauses.join(" OR ")}`;
  }
  // 정렬 컬럼이 text 여도 사전식 정렬이 되지 않도록 숫자만 추출해 numeric 캐스팅.
  const numOrder = (c: string) => `ORDER BY NULLIF(regexp_replace(${qid(c)}::text, '[^0-9]', '', 'g'), '')::numeric DESC NULLS LAST`;
  const orderBy = f.gmv ? numOrder(f.gmv) : f.views ? numOrder(f.views) : "";
  params.push(limit);
  const sql = `SELECT ${selectList} FROM ${qid(table)} ${where} ${orderBy} LIMIT $${params.length}`;
  const rows = await queryRo<Record<string, unknown>>(sql, params).catch((e) => {
    console.warn(`[glovek-content] ${table} 조회 실패:`, (e as Error).message);
    return [] as Record<string, unknown>[];
  });
  return rows.map((r) => ({
    source: table,
    name: str(r.name), brand: str(r.brand), category: str(r.category),
    image_url: str(r.image), link: str(r.link), handle: str(r.handle),
    gmv: str(r.gmv), views: str(r.views),
  }));
}
const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);

/**
 * 브랜드 키워드로 glovek 에서 유사 제품 콘텐츠를 찾는다.
 *   videos(실제 콘텐츠) → products 순으로 시도하고 합쳐서 반환. 스키마가 없거나 비면 [].
 */
export async function similarProductContent(keywords: string[], limit = 8): Promise<GlovekContent[]> {
  const kw = keywords.map((k) => k.trim()).filter(Boolean);
  // 키워드가 없으면 무관한 상위 N개를 "유사 콘텐츠"로 오인 노출하지 않도록 빈 결과 반환.
  if (kw.length === 0) return [];
  const out: GlovekContent[] = [];
  for (const table of ["videos", "products"]) {
    if (out.length >= limit) break;
    const rows = await fromTable(table, kw, limit).catch(() => []);
    out.push(...rows);
  }
  // 핸들/이름 기준 간단 dedupe.
  const seen = new Set<string>();
  const dedup = out.filter((c) => {
    const key = (c.handle || c.name || c.link || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  return dedup.slice(0, limit);
}
