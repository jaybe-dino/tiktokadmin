// 레퍼런스 썸네일 영구 저장(핀) — 불러오기 시점에 외부 이미지를 서버가 즉시 내려받아
//   import_files 에 보관하고 내부 URL 로 치환한다. 이후에는 CDN 만료·Referer 차단과 무관하게
//   항상 표시된다(어드민은 세션 경로, 공개 제안서는 토큰 프록시로 서빙).
//   실패 시(원본 만료 + oEmbed 재조회도 실패) null — 호출부는 원본 URL 을 유지한다.
import { createHash } from "node:crypto";
import { queryOne } from "./db";
import { fetchExternalImage, fetchTikTokOembedThumb } from "./image-fetch";

export async function pinExternalImage(
  brandId: string,
  imageUrl?: string | null,
  pageUrl?: string | null,
): Promise<string | null> {
  const src = (imageUrl ?? "").trim();
  if (!src || !/^https?:\/\//i.test(src)) return null;
  let img = await fetchExternalImage(src, 6_000);
  if (!img && pageUrl) {
    // 서명 만료 커버 — 틱톡 영상 링크로 현재 유효한 썸네일 재조회.
    const fresh = await fetchTikTokOembedThumb(pageUrl, 6_000);
    if (fresh) img = await fetchExternalImage(fresh, 6_000);
  }
  if (!img) return null;
  const key = createHash("sha256").update((pageUrl ?? "") || src).digest("hex").slice(0, 20);
  const sha = createHash("sha256").update(img.bytes).digest("hex");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO import_files (brand_id, doc_field, filename, mime, size, sha256, bytes)
     VALUES ($1,'ref_img',$2,$3,$4,$5,$6)
     ON CONFLICT (brand_id, filename) DO UPDATE SET bytes=EXCLUDED.bytes, mime=EXCLUDED.mime, size=EXCLUDED.size, sha256=EXCLUDED.sha256
     RETURNING id`,
    [brandId, `refimg-${key}.jpg`, img.mime, img.bytes.length, sha, img.bytes],
  ).catch((e) => { console.error("[ref-pin] save:", (e as Error).message); return null; });
  return row ? `/api/brand/import-file/${row.id}` : null;
}
