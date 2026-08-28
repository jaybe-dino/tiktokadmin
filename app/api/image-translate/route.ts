// 어드민 상세페이지 이미지 번역 — 이미지 + 타겟 언어 → 번역된 새 이미지를 브랜드 원장(import_files)에 저장.
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { translateImage, isImgTranslateLang } from "@/lib/image-translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 10 * 1024 * 1024; // 10MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/jpg", "image/webp"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const u = await currentUser().catch(() => null);
  if (!u) return NextResponse.json({ ok: false, error: "세션 만료" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const lang = String(form?.get("lang") ?? "");
  const brandId = String(form?.get("brand_id") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "이미지 파일이 없습니다." }, { status: 400 });
  if (!isImgTranslateLang(lang)) return NextResponse.json({ ok: false, error: "지원 언어: 영어/베트남어/태국어" }, { status: 400 });
  if (!UUID_RE.test(brandId)) return NextResponse.json({ ok: false, error: "브랜드가 지정되지 않았습니다." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ ok: false, error: "10MB 이하 이미지만 가능합니다." }, { status: 400 });
  const mime = file.type || "image/png";
  if (!ALLOWED.has(mime)) return NextResponse.json({ ok: false, error: "JPG/PNG/WEBP 이미지만 가능합니다." }, { status: 400 });

  const src = Buffer.from(await file.arrayBuffer());
  const r = await translateImage(src, mime, lang);
  if (!r.ok || !r.bytes) return NextResponse.json({ ok: false, error: r.error ?? "번역 실패" }, { status: 502 });

  // 번역본을 브랜드 원장 파일(import_files)에 저장 — 같은 파일명 재번역 시 갱신(멱등).
  const base = (file.name || "detail-page").replace(/\.[a-z0-9]+$/i, "");
  const ext = r.mime === "image/jpeg" ? "jpg" : "png";
  const filename = `${base}.translated-${lang}.${ext}`;
  const sha = createHash("sha256").update(r.bytes).digest("hex");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO import_files (brand_id, doc_field, filename, mime, size, sha256, bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (brand_id, filename) DO UPDATE SET bytes=EXCLUDED.bytes, mime=EXCLUDED.mime, size=EXCLUDED.size, sha256=EXCLUDED.sha256
     RETURNING id`,
    [brandId, `detail_page_${lang}`, filename, r.mime, r.bytes.length, sha, r.bytes],
  ).catch((e) => { console.error("[image-translate] save:", (e as Error).message); return null; });
  if (!row) return NextResponse.json({ ok: false, error: "번역본 저장 실패" }, { status: 500 });

  await query(
    `INSERT INTO assets (brand_id, kind, filename, storage_url, source)
     VALUES ($1,'etc',$2,$3,'image_translate') ON CONFLICT DO NOTHING`,
    [brandId, filename, `/api/brand/import-file/${row.id}`],
  ).catch(() => {});

  return NextResponse.json({ ok: true, url: `/api/brand/import-file/${row.id}`, filename, note: r.note });
}
