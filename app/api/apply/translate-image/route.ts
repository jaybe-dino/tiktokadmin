// 온보딩 고객(브랜드 담당자) 상세페이지 이미지 번역 — 제품 등록 단계에서 직접 번역.
//   번역된 새 이미지를 onb_files 에 저장하고 /api/apply/file/<id> URL 을 반환한다.
import { NextRequest, NextResponse } from "next/server";
import { currentOnbCustomer, getOrCreateApplication, saveOnbFile } from "@/lib/onboarding";
import { translateImage, isImgTranslateLang } from "@/lib/image-translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 밴드 파이프라인(감지→번역→밴드별 편집)은 최고품질 모델 기준 1~2분까지 걸릴 수 있다.
export const maxDuration = 120;

const MAX = 10 * 1024 * 1024; // 10MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/jpg", "image/webp"]);

export async function POST(req: NextRequest) {
  const c = await currentOnbCustomer();
  if (!c) return NextResponse.json({ ok: false, error: "세션이 만료되었습니다." }, { status: 401 });
  const { id: appId } = await getOrCreateApplication(c.id, c.brand_id);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const lang = String(form?.get("lang") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "이미지 파일이 없습니다." }, { status: 400 });
  if (!isImgTranslateLang(lang)) return NextResponse.json({ ok: false, error: "지원 언어: 영어/베트남어/태국어" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ ok: false, error: "10MB 이하 이미지만 가능합니다." }, { status: 400 });
  const mime = file.type || "image/png";
  if (!ALLOWED.has(mime)) return NextResponse.json({ ok: false, error: "JPG/PNG/WEBP 이미지만 가능합니다." }, { status: 400 });

  const src = Buffer.from(await file.arrayBuffer());
  const r = await translateImage(src, mime, lang);
  if (!r.ok || !r.bytes) return NextResponse.json({ ok: false, error: r.error ?? "번역 실패" }, { status: 502 });

  const base = (file.name || "detail-page").replace(/\.[a-z0-9]+$/i, "");
  const ext = r.mime === "image/jpeg" ? "jpg" : "png";
  const saved = await saveOnbFile(appId, `detail_page_${lang}`, `${base}.translated-${lang}.${ext}`, r.mime ?? "image/png", r.bytes, c.email);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error ?? "번역본 저장 실패" }, { status: 500 });

  return NextResponse.json({ ok: true, url: saved.url, filename: `${base}.translated-${lang}.${ext}`, note: r.note });
}
