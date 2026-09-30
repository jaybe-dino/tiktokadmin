import { NextRequest, NextResponse } from "next/server";
import {
  currentOnbCustomer, getOrCreateApplication, saveOnbFile, listOnbFiles,
  COMPANY_DOCS_FIELD, COMPANY_DOCS_MAX_BYTES, COMPANY_DOCS_MAX_COUNT,
} from "@/lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 10 * 1024 * 1024; // 10MB — 신분증·등기부 등 정형 서류 슬롯
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/jpg"]);

// 회사자료(브랜드 소개서 등)는 형식이 다양하고 용량도 크다 —
//   이 슬롯만 50MB · 문서/압축까지 허용한다. 다른 슬롯은 기존 규칙 그대로.
const DOC_EXT = /\.(pdf|jpe?g|png|ppt|pptx|doc|docx|xls|xlsx|key|pages|numbers|zip|hwp|hwpx)$/i;
const mb = (n: number) => `${Math.round(n / (1024 * 1024))}MB`;

// 고객 온보딩 파일 업로드 → Neon DB(onb_files) 저장 → { url } 반환.
export async function POST(req: NextRequest) {
  const c = await currentOnbCustomer();
  if (!c) return NextResponse.json({ ok: false, error: "세션이 만료되었습니다." }, { status: 401 });
  const { id: appId } = await getOrCreateApplication(c.id, c.brand_id);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const field = String(form?.get("field") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "파일이 없습니다." }, { status: 400 });

  const isCompanyDocs = field === COMPANY_DOCS_FIELD;
  const limit = isCompanyDocs ? COMPANY_DOCS_MAX_BYTES : MAX;
  if (file.size > limit) {
    return NextResponse.json({ ok: false, error: `${mb(limit)} 이하만 가능합니다(올린 파일 ${mb(file.size)}).` }, { status: 400 });
  }
  if (isCompanyDocs) {
    // 무한정 쌓이지 않게 개수만 제한한다(지운 파일은 세지 않는다).
    const have = await listOnbFiles(appId, COMPANY_DOCS_FIELD).catch(() => []);
    if (have.length >= COMPANY_DOCS_MAX_COUNT) {
      return NextResponse.json(
        { ok: false, error: `최대 ${COMPANY_DOCS_MAX_COUNT}개까지 올릴 수 있습니다 — 기존 파일을 지운 뒤 다시 시도해주세요.` },
        { status: 400 });
    }
  }

  // MIME 은 브라우저·OS 에 따라 제각각(윈도우에서 PDF 가 application/x-pdf·빈값 등) —
  // 브라우저 MIME + 확장자 + 실제 파일 내용(매직바이트) 순으로 판별하고, 저장 MIME 은 내용 기준으로 교정.
  const browserMime = file.type || "";
  const extOk = isCompanyDocs ? DOC_EXT.test(file.name || "") : /\.(pdf|jpe?g|png)$/i.test(file.name || "");
  if (!ALLOWED.has(browserMime) && !extOk) {
    return NextResponse.json({
      ok: false,
      error: isCompanyDocs
        ? "PDF · 이미지 · PPT · 워드 · 엑셀 · 한글 · ZIP 만 가능합니다."
        : "PDF/JPG/PNG 만 가능합니다.",
    }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  let mime: string;
  if (bytes.slice(0, 4).toString("latin1") === "%PDF") mime = "application/pdf";
  else if (bytes[0] === 0x89 && bytes.slice(1, 4).toString("latin1") === "PNG") mime = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = "image/jpeg";
  // 회사자료 슬롯: Office(=ZIP 컨테이너)·구버전 Office(OLE)·ZIP 도 내용으로 확인한다.
  else if (isCompanyDocs && bytes.slice(0, 2).toString("latin1") === "PK") {
    mime = browserMime && browserMime !== "application/octet-stream" ? browserMime : "application/zip";
  }
  else if (isCompanyDocs && bytes.slice(0, 8).toString("hex").toLowerCase() === "d0cf11e0a1b11ae1") {
    mime = browserMime && browserMime !== "application/octet-stream" ? browserMime : "application/vnd.ms-office";
  }
  else if (isCompanyDocs && extOk) mime = browserMime || "application/octet-stream";
  else if (ALLOWED.has(browserMime)) mime = browserMime === "image/jpg" ? "image/jpeg" : browserMime;
  else return NextResponse.json({ ok: false, error: "파일 내용이 PDF/JPG/PNG 형식이 아닙니다 — 파일을 다시 확인해주세요." }, { status: 400 });

  const r = await saveOnbFile(appId, field, file.name || "upload", mime, bytes, c.email);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "업로드 실패" }, { status: 500 });
  return NextResponse.json({ ok: true, url: r.url, filename: file.name });
}
