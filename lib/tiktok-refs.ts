// 틱톡 레퍼런스 자동조회 — Apify 로 ① 틱톡 영상 검색(조회수·크리에이터·썸네일) ② 틱톡샵 제품 검색.
//   회의 확정 워크플로: 유사제품 키워드 → 틱톡 검색 → 조회수 높은 콘텐츠 썸네일 캡처 + 크리에이터명 → 제안서 레퍼런스.
//   액터 스키마는 업체별로 다를 수 있어 입력은 별칭 필드를 함께 보내고, 출력은 방어적으로 파싱한다.
//   액터 교체: APIFY_TIKTOK_ACTOR / APIFY_TIKTOK_SHOP_ACTOR 환경변수로 오버라이드.
import { env } from "./env";
import { fetchExternalImage } from "./image-fetch";

const VIDEO_ACTOR = process.env.APIFY_TIKTOK_ACTOR || "clockworks~tiktok-scraper";
const SHOP_ACTOR = process.env.APIFY_TIKTOK_SHOP_ACTOR || "trakk~tiktok-shop-search-scraper";

export interface TikTokVideoRef {
  videoId: string;
  url: string;
  coverUrl: string;
  playCount: number;
  likeCount: number;
  creator: string;   // @핸들
  caption: string;
}
export interface TikTokShopItem {
  title: string;
  price: string;     // 원문 표기 그대로("$12.99" 등)
  shopName: string;
  imageUrl: string;
  url: string;
}

export function apifyEnabled(): boolean {
  return Boolean(env.apifyToken);
}

/** 조회수 표기 — 1234567 → "1.2M", 45300 → "45.3K". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

/** Apify 액터 동기 실행 → dataset items. 실패 시 throw(호출부에서 한국어 메시지로 변환). */
async function runApify(actorId: string, input: Record<string, unknown>, timeoutSec = 180): Promise<Record<string, unknown>[]> {
  const token = env.apifyToken;
  if (!token) throw new Error("APIFY_TOKEN 미설정");
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeoutSec}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), (timeoutSec + 20) * 1000);
  const res = await fetch(url, {
    method: "POST", signal: ctl.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[apify]", actorId, res.status, body.slice(0, 300));
    throw new Error(`Apify ${res.status}`);
  }
  const json = await res.json().catch(() => []);
  return Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
}

const s = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    // "a.b" 형태 중첩 키 지원.
    const v = k.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), o);
    if (v != null && v !== "") return v;
  }
  return undefined;
}

/** 틱톡 영상 키워드 검색 — 조회수 내림차순 상위 반환. country: US/TH/VN/PH/MY/SG. */
export async function searchTikTokVideos(keyword: string, country: string, limit = 12): Promise<TikTokVideoRef[]> {
  const items = await runApify(VIDEO_ACTOR, {
    searchQueries: [keyword],
    resultsPerPage: limit,
    searchSection: "/video",
    proxyCountryCode: country || "US",
    region: country || "US",
    maxItems: limit,
  });
  const out: TikTokVideoRef[] = [];
  for (const it of items) {
    const cover = s(pick(it, "videoMeta.coverUrl", "videoMeta.cover", "covers.0", "cover", "coverUrl", "video.cover"));
    const id = s(pick(it, "id", "videoId", "aweme_id"));
    if (!id && !cover) continue;
    out.push({
      videoId: id || cover.slice(-16),
      url: s(pick(it, "webVideoUrl", "url", "shareUrl", "video_url")),
      coverUrl: cover,
      playCount: num(pick(it, "playCount", "stats.playCount", "videoMeta.playCount", "play_count")),
      likeCount: num(pick(it, "diggCount", "stats.diggCount", "likeCount", "like_count")),
      creator: s(pick(it, "authorMeta.name", "author.uniqueId", "authorUniqueId", "author.nickname", "authorMeta.nickName")),
      caption: s(pick(it, "text", "desc", "caption")).slice(0, 120),
    });
  }
  return out.filter((v) => v.coverUrl).sort((a, b) => b.playCount - a.playCount);
}

/** 틱톡샵 제품 키워드 검색 — 유사 SKU 리스팅(제품명·가격·샵·이미지). */
export async function searchTikTokShop(keyword: string, country: string, limit = 6): Promise<TikTokShopItem[]> {
  const items = await runApify(SHOP_ACTOR, {
    keyword, searchTerm: keyword, query: keyword, searchQueries: [keyword],
    country: country || "US", region: country || "US",
    maxItems: limit, limit, resultsPerPage: limit,
  });
  const out: TikTokShopItem[] = [];
  for (const it of items.slice(0, limit * 2)) {
    const title = s(pick(it, "title", "name", "productName", "product_name"));
    const img = s(pick(it, "imageUrl", "image", "cover", "coverUrl", "images.0", "mainImage"));
    if (!title) continue;
    out.push({
      title: title.slice(0, 120),
      price: s(pick(it, "price", "priceText", "price.formatted", "salePrice", "price_str")),
      shopName: s(pick(it, "shopName", "sellerName", "shop.name", "seller.name")),
      imageUrl: img,
      url: s(pick(it, "url", "productUrl", "link", "detailUrl")),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** 원격 이미지 다운로드(썸네일 영구 보관용) — 공용 유틸 위임(이미지 MIME 만, 실패 시 null). */
export async function fetchImageBytes(url: string): Promise<{ bytes: Buffer; mime: string } | null> {
  return fetchExternalImage(url, 15_000);
}
