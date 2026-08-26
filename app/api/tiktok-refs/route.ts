// 틱톡 레퍼런스 자동조회(어드민) — 마케팅 제안서의 제품으로 유사제품 키워드를 만들어
//   ① 틱톡 영상(조회수 상위, 썸네일+크리에이터) ② 틱톡샵 유사 제품 리스팅을 수집,
//   썸네일을 브랜드 파일(import_files)에 영구 저장해 레퍼런스 카드 데이터로 반환한다.
//   (제안서 공개 페이지에선 /api/proposal-asset 프록시로 재작성되어 고객에게도 표시됨)
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { aiText, aiEnabled } from "@/lib/ai";
import { getMktProposalById, type MktReferenceItem } from "@/lib/mkt-proposal-doc";
import { apifyEnabled, searchTikTokVideos, searchTikTokShop, fetchImageBytes, formatCount } from "@/lib/tiktok-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Apify 액터 실행 대기(플랜에 따라 60초로 잘리면 결과가 늦게 올 수 있음)

async function saveRefImage(brandId: string, filename: string, mime: string, bytes: Buffer): Promise<string | null> {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO import_files (brand_id, doc_field, filename, mime, size, sha256, bytes)
     VALUES ($1,'tiktok_ref',$2,$3,$4,$5,$6)
     ON CONFLICT (brand_id, filename) DO UPDATE SET bytes=EXCLUDED.bytes, mime=EXCLUDED.mime, size=EXCLUDED.size, sha256=EXCLUDED.sha256
     RETURNING id`,
    [brandId, filename, mime, bytes.length, sha, bytes],
  ).catch((e) => { console.error("[tiktok-refs] save:", (e as Error).message); return null; });
  return row ? `/api/brand/import-file/${row.id}` : null;
}

/** 제품명+특징(상세페이지에서 파악된 것) → 틱톡 검색용 영어 키워드(유사제품 일반명). AI 미설정 시 영문명/원문 폴백. */
async function searchKeyword(name: string, nameEn: string | undefined, features: string): Promise<string> {
  if (aiEnabled()) {
    const kw = await aiText({
      system: "제품명과 특징을 보고, 이 제품과 '유사한 제품'을 TikTok에서 찾기 위한 짧은 영어 검색 키워드(2~4단어, 일반명사 중심)로 변환한다. 브랜드명은 빼고 제품 종류·핵심효능만. 키워드만 출력.",
      user: `제품명: ${name}${nameEn ? ` (${nameEn})` : ""}${features ? `\n제품 특징: ${features.slice(0, 300)}` : ""}`,
      maxTokens: 30,
    }).catch(() => null);
    const clean = (kw ?? "").trim().replace(/^["']|["']$/g, "").split("\n")[0];
    if (clean && clean.length <= 60) return clean;
  }
  return (nameEn || name).slice(0, 60);
}

export async function POST(req: NextRequest) {
  const u = await currentUser().catch(() => null);
  if (!u) return NextResponse.json({ ok: false, error: "세션 만료" }, { status: 401 });
  if (!apifyEnabled()) return NextResponse.json({ ok: false, error: "APIFY_TOKEN 미설정 — Vercel 환경변수 확인(관리자)." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const docId = String(body.doc_id ?? "");
  if (!docId) return NextResponse.json({ ok: false, error: "제안서 id 가 없습니다." }, { status: 400 });
  const doc = await getMktProposalById(docId);
  if (!doc) return NextResponse.json({ ok: false, error: "제안서를 찾을 수 없습니다." }, { status: 404 });
  if (!doc.brand_id) return NextResponse.json({ ok: false, error: "브랜드가 연결되지 않은 제안서입니다 — 브랜드 연결 후 실행하세요." }, { status: 400 });

  const products = (doc.products_json ?? []).filter((p) => p.name).slice(0, 2); // 비용 통제: 상위 2개 SKU
  if (products.length === 0) return NextResponse.json({ ok: false, error: "제품이 없습니다 — 제품을 먼저 저장하세요." }, { status: 400 });
  const country = (doc.countries?.[0] as string) || "US";

  const refs: MktReferenceItem[] = [];
  const warnings: string[] = [];

  for (const p of products) {
    // 상세페이지에서 파악된 제품 특징(features)까지 반영해 '유사제품' 키워드를 만든다.
    const kw = await searchKeyword(p.name, p.name_en, (p.features ?? []).filter(Boolean).join(" · "));
    // ① 영상 — 조회수 상위 4개(1 SKU당, 회의 확정 기준).
    try {
      const videos = await searchTikTokVideos(kw, country, 12);
      let added = 0;
      for (const v of videos) {
        if (added >= 4) break;
        const img = await fetchImageBytes(v.coverUrl);
        if (!img) continue;
        const url = await saveRefImage(doc.brand_id, `tiktokref-${v.videoId}.jpg`, img.mime, img.bytes);
        if (!url) continue;
        refs.push({
          creator: v.creator ? `@${v.creator.replace(/^@/, "")}` : "",
          product: p.name,
          engagement: `조회수 ${formatCount(v.playCount)}`,
          desc: (v.caption ?? "").slice(0, 120),
          image_url: url,
          url: v.url || undefined, // 썸네일 클릭 → 틱톡 영상
        });
        added++;
      }
      if (added === 0) warnings.push(`「${kw}」 영상 검색 결과가 없거나 썸네일 저장에 실패했습니다.`);
    } catch (e) {
      console.error("[tiktok-refs] video:", (e as Error).message);
      warnings.push(`「${kw}」 영상 검색 실패 — Apify 액터/크레딧을 확인하세요.`);
    }
    // ② 틱톡샵 유사 제품 — 상위 2개.
    try {
      const shopItems = await searchTikTokShop(kw, country, 4);
      let added = 0;
      for (const it of shopItems) {
        if (added >= 2) break;
        let url = "";
        if (it.imageUrl) {
          const img = await fetchImageBytes(it.imageUrl);
          if (img) url = (await saveRefImage(doc.brand_id, `tiktokshop-${createHash("sha256").update(it.title).digest("hex").slice(0, 12)}.jpg`, img.mime, img.bytes)) ?? "";
        }
        refs.push({
          product: it.title,
          gmv: it.price || undefined,
          desc: `TikTok Shop 유사 제품${it.shopName ? ` · ${it.shopName}` : ""}`.slice(0, 120),
          image_url: url || undefined,
          url: it.url || undefined, // 썸네일 클릭 → 틱톡샵 상품
        });
        added++;
      }
    } catch (e) {
      console.error("[tiktok-refs] shop:", (e as Error).message);
      warnings.push(`「${kw}」 틱톡샵 검색 실패 — 액터(APIFY_TIKTOK_SHOP_ACTOR)를 확인하세요.`);
    }
  }

  if (refs.length === 0) return NextResponse.json({ ok: false, error: warnings.join(" / ") || "결과가 없습니다." }, { status: 502 });
  return NextResponse.json({ ok: true, refs, warnings });
}
