// 레퍼런스 썸네일 영구 저장(핀) — 불러오기 시점에 외부 이미지를 서버가 즉시 내려받아
//   import_files 에 보관하고 내부 URL 로 치환한다. 이후에는 CDN 만료·Referer 차단과 무관하게
//   항상 표시된다(어드민은 세션 경로, 공개 제안서는 토큰 프록시로 서빙).
//   실패 시(원본 만료 + oEmbed 재조회도 실패) null — 호출부는 원본 URL 을 유지한다.
import { createHash } from "node:crypto";
import { queryOne } from "./db";
import { fetchExternalImage, fetchTikTokOembedThumb } from "./image-fetch";

export type InternalImageCheck =
  | { status: "ok" }
  | { status: "healed"; url: string }
  | { status: "dead"; reason: string }
  | { status: "skip" };

/** 내부 저장 경로(/api/brand/import-file/<id>) 검증·자가복구.
 *  공개 제안서 프록시(/api/proposal-asset)는 "파일 존재 + 문서 브랜드 일치 + image/*" 를 요구하므로
 *  같은 조건을 미리 검사한다. 브랜드 불일치(다른 브랜드 문서에서 복사된 레퍼런스 등)는 바이트를
 *  이 브랜드로 복사해 복구하고, 파일 유실은 콘텐츠 링크(pageUrl)로 재수집(glovek 현재 커버 → oEmbed)한다. */
export async function verifyInternalImage(
  brandId: string,
  imageUrl?: string | null,
  pageUrl?: string | null,
): Promise<InternalImageCheck> {
  const src = (imageUrl ?? "").trim();
  const m = src.match(/^\/api\/brand\/import-file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!m) return { status: "skip" };
  const f = await queryOne<{ brand_id: string; mime: string | null }>(
    "SELECT brand_id, mime FROM import_files WHERE id=$1", [m[1]],
  ).catch(() => null);
  if (f && String(f.brand_id) === String(brandId) && (f.mime ?? "").startsWith("image/")) return { status: "ok" };
  if (f && (f.mime ?? "").startsWith("image/")) {
    // 다른 브랜드 소유 파일 — 공개 프록시가 403 을 반환하므로 이 브랜드 소유로 바이트 복사(재다운로드 불필요).
    const full = await queryOne<{ mime: string | null; bytes: Buffer }>(
      "SELECT mime, bytes FROM import_files WHERE id=$1", [m[1]],
    ).catch(() => null);
    if (full?.bytes?.length) {
      const key = createHash("sha256").update((pageUrl ?? "") || src).digest("hex").slice(0, 20);
      const sha = createHash("sha256").update(full.bytes).digest("hex");
      const row = await queryOne<{ id: string }>(
        `INSERT INTO import_files (brand_id, doc_field, filename, mime, size, sha256, bytes)
         VALUES ($1,'ref_img',$2,$3,$4,$5,$6)
         ON CONFLICT (brand_id, filename) DO UPDATE SET bytes=EXCLUDED.bytes, mime=EXCLUDED.mime, size=EXCLUDED.size, sha256=EXCLUDED.sha256
         RETURNING id`,
        [brandId, `refimg-${key}.jpg`, full.mime, full.bytes.length, sha, full.bytes],
      ).catch((e) => { console.error("[ref-pin] copy:", (e as Error).message); return null; });
      if (row) return { status: "healed", url: `/api/brand/import-file/${row.id}` };
    }
  }
  // 파일 유실(또는 이미지가 아님) — 콘텐츠 링크로 현재 유효한 썸네일을 재수집해 재핀.
  if (pageUrl) {
    const { latestGlovekCover } = await import("./glovek-content");
    const gv = await latestGlovekCover(pageUrl).catch(() => null);
    const cand = gv || (await fetchTikTokOembedThumb(pageUrl, 6_000));
    if (cand) {
      const pinned = await pinExternalImage(brandId, cand, pageUrl);
      if (pinned) return { status: "healed", url: pinned };
    }
  }
  return {
    status: "dead",
    reason: !f ? "내부 파일 유실" : (f.mime ?? "").startsWith("image/") ? "브랜드 복사 실패" : "이미지 아님",
  };
}

export async function pinExternalImage(
  brandId: string,
  imageUrl?: string | null,
  pageUrl?: string | null,
): Promise<string | null> {
  const src = (imageUrl ?? "").trim();
  if (!src || !/^https?:\/\//i.test(src)) return null;
  let img = await fetchExternalImage(src, 6_000);
  if (!img && pageUrl) {
    // 서명 만료 커버 보정 ①: glovek DB 의 "현재" cover_url 재조회(크롤러 재수집분 — 가장 확실).
    const { latestGlovekCover } = await import("./glovek-content");
    const gv = await latestGlovekCover(pageUrl).catch(() => null);
    if (gv && gv !== src) img = await fetchExternalImage(gv, 6_000);
  }
  if (!img && pageUrl) {
    // 보정 ②: 틱톡 oEmbed 로 현재 유효한 썸네일 재조회.
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
