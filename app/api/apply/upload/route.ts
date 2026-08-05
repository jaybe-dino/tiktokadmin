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
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) return NextResponse.json({ ok: false, error: "PDF/JPG/PNG 만 가능합니다." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const r = await saveOnbFile(appId, field, file.name || "upload", mime, bytes, c.email);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "업로드 실패" }, { status: 500 });
  return NextResponse.json({ ok: true, url: r.url, filename: file.name });
}
