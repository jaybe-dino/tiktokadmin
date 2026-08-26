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

export interface FieldMap { name?: string; brand?: string; category?: string; image?: string; link?: string; handle?: string; gmv?: string; views?: string }
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

/** glovek 콘텐츠 조회 가능 상태 진단 — "매칭 0건"과 "연결/스키마 문제"를 구분해 UI 에 알려주기 위함.
 *   configured=false 면 GLOVEK_DB_URL_RO 미설정 → 어드민 DB 로 폴백돼 사실상 항상 0건. */
export async function glovekContentStatus(): Promise<{ configured: boolean; videos: boolean; products: boolean }> {
  const configured = Boolean(process.env.GLOVEK_DB_URL_RO?.trim());
  const v = await columnsOf("videos");
  const p = await columnsOf("products");
  return { configured, videos: v.length > 0, products: p.length > 0 };
}

// ── 데이터 프로파일(설정→진단 카드용) — 실데이터 유무·카테고리 실값 분포를 어드민에서 눈으로 확인 ──
export interface GlovekTableProfile {
  table: string;
  exists: boolean;
  rows: number | null;                                // 대략 행수(estimate, 없으면 정확 카운트)
  columns: string[];                                  // 원시 컬럼명 전체(매핑 튜닝용)
  fields: FieldMap;                                   // 휴리스틱으로 매핑된 실제 컬럼명
  categories: { value: string; count: number }[];     // 카테고리 실값 상위 30 + 건수
  samples: string[];                                  // 이름 샘플 5건
}

export async function glovekDataProfile(): Promise<{ configured: boolean; tables: GlovekTableProfile[] }> {
  const configured = Boolean(process.env.GLOVEK_DB_URL_RO?.trim());
  const tables: GlovekTableProfile[] = [];
  for (const t of ["videos", "products"]) {
    const cols = await columnsOf(t);
    if (cols.length === 0) {
      tables.push({ table: t, exists: false, rows: null, columns: [], fields: {}, categories: [], samples: [] });
      continue;
    }
    const f = mapFields(cols);
    // 행수: pg_class 추정치(빠름) → 추정 불가·0이면 정확 카운트 폴백.
    let rows: number | null = null;
    const est = await queryRo<{ n: string }>("SELECT reltuples::bigint AS n FROM pg_class WHERE relname=$1", [t]).catch(() => []);
    if (est[0]) rows = Math.max(0, Number(est[0].n));
    if (!rows) {
      const c = await queryRo<{ n: string }>(`SELECT count(*) AS n FROM ${qid(t)}`).catch(() => []);
      if (c[0]) rows = Number(c[0].n);
    }
    let categories: { value: string; count: number }[] = [];
    if (f.category) {
      categories = (
        await queryRo<{ v: string | null; n: string }>(
          `SELECT ${qid(f.category)}::text AS v, count(*) AS n FROM ${qid(t)} GROUP BY 1 ORDER BY n DESC LIMIT 30`,
        ).catch(() => [])
      ).map((r) => ({ value: (r.v ?? "").trim() || "(빈값)", count: Number(r.n) }));
    }
    let samples: string[] = [];
    if (f.name) {
      samples = (
        await queryRo<{ v: string | null }>(
          `SELECT ${qid(f.name)}::text AS v FROM ${qid(t)} WHERE ${qid(f.name)} IS NOT NULL LIMIT 5`,
        ).catch(() => [])
      ).map((r) => String(r.v).trim().slice(0, 60)).filter(Boolean);
    }
    tables.push({ table: t, exists: true, rows, columns: cols, fields: f, categories, samples });
  }
  return { configured, tables };
}

/** glovek DB 의 실제 카테고리 값 목록(videos+products 합산, 건수 내림차순) —
 *  제안서 레퍼런스 검색에서 "실값 그대로 선택"할 수 있게 UI 에 제공. */
export async function listGlovekCategories(limit = 60): Promise<{ value: string; count: number }[]> {
  const merged = new Map<string, number>();
  for (const t of ["videos", "products"]) {
    const cols = await columnsOf(t);
    if (cols.length === 0) continue;
    const f = mapFields(cols);
    if (!f.category) continue;
    const rows = await queryRo<{ v: string | null; n: string }>(
      `SELECT ${qid(f.category)}::text AS v, count(*) AS n FROM ${qid(t)}
        WHERE ${qid(f.category)} IS NOT NULL AND btrim(${qid(f.category)}::text) <> ''
        GROUP BY 1 ORDER BY n DESC LIMIT $1`,
      [limit],
    ).catch(() => []);
    for (const r of rows) {
      const v = (r.v ?? "").trim();
      if (v) merged.set(v, (merged.get(v) ?? 0) + Number(r.n));
    }
  }
  return [...merged.entries()].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
}

/** 매칭 0건일 때 원인 안내 문구(한국어) — 액션들이 note 에 붙인다. */
export async function glovekZeroDiagnosis(): Promise<string> {
  const st = await glovekContentStatus().catch(() => null);
  if (!st) return "glovek DB 상태 확인 실패";
  if (!st.configured) return "원인: GLOVEK_DB_URL_RO 미설정 — glovek DB 가 연결되지 않아 검색이 되지 않습니다(설정→연동 상태에서 확인)";
  if (!st.videos && !st.products) return "원인: glovek DB 에 videos/products 테이블이 보이지 않습니다 — RO 계정 권한/스키마 확인 필요";
  return "glovek 연결은 정상 — 이 카테고리와 매칭되는 데이터가 없습니다(다른 소분류를 선택해보세요)";
}

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
