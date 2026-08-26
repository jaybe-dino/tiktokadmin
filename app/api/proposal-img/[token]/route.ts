// 제안서 공개 페이지 웹썸네일 프록시 — 외부 이미지 URL(브랜드 로고·제품·레퍼런스 썸네일)을 서버가
//   대신 받아 표시한다. 핫링크(Referer) 차단·CORS 로 브라우저에서 깨지던 이미지도 뜨고,
//   첫 성공 시 import_files 에 영구 캐시해 원본 URL 이 만료돼도(틱톡 CDN 등) 계속 보인다.
//   보안: 토큰의 제안서 문서에 실제로 들어있는 이미지 URL 만 프록시(오픈 프록시/SSRF 차단),
//   응답도 이미지 MIME 만 통과. 최종 실패 시 회색 플레이스홀더 SVG 를 반환해 깨진 아이콘을 막는다.
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { normalizeImageUrl } from "@/lib/asset-url";
import { fetchExternalImage } from "@/lib/image-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PLACEHOLDER_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">` +
  `<rect width="640" height="640" fill="#f1f0f3"/>` +
  `<circle cx="320" cy="290" r="64" fill="none" stroke="#c9c4cf" stroke-width="10"/>` +
  `<path d="M275 300l30-34 26 24 20-16 34 40z" fill="#c9c4cf"/>` +
  `<text x="320" y="420" text-anchor="middle" fill="#a49dab" font-size="26" font-weight="700" font-family="sans-serif">이미지 준비중</text>` +
  `</svg>`;

function placeholder(): NextResponse {
  return new NextResponse(PLACEHOLDER_SVG, {
    status: 200,
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=1800" },
  });
}

const asArray = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** 토큰 → 문서에 실제 포함된 이미지 URL 목록(원문+정규화형 모두) + 브랜드. 운영 제안서 → 마케팅 제안서 순. */
async function allowedForToken(token: string): Promise<{ brandId: string | null; allowed: Set<string> } | null> {
  const push = (set: Set<string>, u: unknown) => {
    const raw = typeof u === "string" ? u.trim() : "";
    if (!raw) return;
    set.add(raw);
    set.add(normalizeImageUrl(raw));
  };
  const ops = await queryOne<{ brand_id: string | null; brand_logo_url: string | null; products: unknown; creators: unknown }>(
    "SELECT brand_id, brand_logo_url, products, creators FROM proposal_docs WHERE token=$1", [token],
  ).catch(() => null);
  if (ops) {
    const allowed = new Set<string>();
    push(allowed, ops.brand_logo_url);
    for (const p of asArray(ops.products)) push(allowed, p.image_url);
    for (const c of asArray(ops.creators)) push(allowed, c.thumb_url);
    return { brandId: ops.brand_id, allowed };
  }
  const mkt = await queryOne<{ brand_id: string | null; products_json: unknown; references_json: unknown }>(
    "SELECT brand_id, products_json, references_json FROM mkt_proposal_docs WHERE token=$1", [token],
  ).catch(() => null);
  if (mkt) {
    const allowed = new Set<string>();
    for (const p of asArray(mkt.products_json)) push(allowed, p.image_url);
    for (const r of asArray(mkt.references_json)) push(allowed, r.image_url);
    return { brandId: mkt.brand_id, allowed };
  }
  return null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const u = (req.nextUrl.searchParams.get("u") ?? "").trim();
  if (!token || !u || !/^https?:\/\//i.test(u)) return placeholder();

  const doc = await allowedForToken(token);
  if (!doc) return new NextResponse("not found", { status: 404 });
  if (!doc.allowed.has(u)) return new NextResponse("forbidden", { status: 403 });

  // 1) 영구 캐시 조회 — 같은 URL 은 최초 1회만 원본에서 받는다(만료 URL 도 캐시로 생존).
  const cacheName = `webimg-${createHash("sha256").update(u).digest("hex").slice(0, 24)}`;
  if (doc.brandId) {
    const hit = await queryOne<{ bytes: Buffer; mime: string }>(
      "SELECT bytes, mime FROM import_files WHERE brand_id=$1 AND filename=$2", [doc.brandId, cacheName],
    ).catch(() => null);
    if (hit?.bytes?.length) {
      return new NextResponse(new Uint8Array(hit.bytes), {
        headers: { "Content-Type": hit.mime || "image/jpeg", "Cache-Control": "public, max-age=86400" },
      });
    }
  }

  // 2) 원본 다운로드(서버 → 브라우저 UA·Referer 정책) → 캐시 저장 → 응답.
  const img = await fetchExternalImage(u);
  if (!img) {
    // 서버 fetch 가 차단돼도(틱톡 CDN 봇 차단 등) 브라우저 직접 로드는 되는 경우가 많다
    // (페이지 <img> 가 no-referrer 라 glovek.space 와 동일 경로) — 원본으로 리다이렉트해 표시 우선.
    return NextResponse.redirect(u, { status: 302, headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (doc.brandId) {
    const sha = createHash("sha256").update(img.bytes).digest("hex");
    await queryOne(
      `INSERT INTO import_files (brand_id, doc_field, filename, mime, size, sha256, bytes)
       VALUES ($1,'web_img',$2,$3,$4,$5,$6)
       ON CONFLICT (brand_id, filename) DO UPDATE SET bytes=EXCLUDED.bytes, mime=EXCLUDED.mime, size=EXCLUDED.size, sha256=EXCLUDED.sha256`,
      [doc.brandId, cacheName, img.mime, img.bytes.length, sha, img.bytes],
    ).catch((e) => console.error("[proposal-img] cache:", (e as Error).message));
  }
  return new NextResponse(new Uint8Array(img.bytes), {
    headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=86400" },
  });
}
