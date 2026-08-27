import { NextRequest, NextResponse } from "next/server";
import { currentOnbCustomer, getOrCreateApplication, saveOnbFile } from "@/lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 10 * 1024 * 1024; // 10MB
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/jpg"]);

// 고객 온보딩 파일 업로드 → Neon DB(onb_files) 저장 → { url } 반환.
export async function POST(req: NextRequest) {
  const c = await currentOnbCustomer();
  if (!c) return NextResponse.json({ ok: false, error: "세션이 만료되었습니다." }, { status: 401 });
  const { id: appId } = await getOrCreateApplication(c.id, c.brand_id);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const field = String(form?.get("field") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "파일이 없습니다." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ ok: false, error: "10MB 이하만 가능합니다." }, { status: 400 });

  // MIME 은 브라우저·OS 에 따라 제각각(윈도우에서 PDF 가 application/x-pdf·빈값 등) —
  // 브라우저 MIME + 확장자 + 실제 파일 내용(매직바이트) 순으로 판별하고, 저장 MIME 은 내용 기준으로 교정.
  const browserMime = file.type || "";
  const extOk = /\.(pdf|jpe?g|png)$/i.test(file.name || "");
  if (!ALLOWED.has(browserMime) && !extOk) {
    return NextResponse.json({ ok: false, error: "PDF/JPG/PNG 만 가능합니다." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  let mime: string;
  if (bytes.slice(0, 4).toString("latin1") === "%PDF") mime = "application/pdf";
  else if (bytes[0] === 0x89 && bytes.slice(1, 4).toString("latin1") === "PNG") mime = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = "image/jpeg";
  else if (ALLOWED.has(browserMime)) mime = browserMime === "image/jpg" ? "image/jpeg" : browserMime;
  else return NextResponse.json({ ok: false, error: "파일 내용이 PDF/JPG/PNG 형식이 아닙니다 — 파일을 다시 확인해주세요." }, { status: 400 });

  const r = await saveOnbFile(appId, field, file.name || "upload", mime, bytes, c.email);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "업로드 실패" }, { status: 500 });
  return NextResponse.json({ ok: true, url: r.url, filename: file.name });
}
