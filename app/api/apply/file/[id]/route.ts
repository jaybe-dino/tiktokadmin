import { NextRequest, NextResponse } from "next/server";
import { currentOnbCustomer, getApplicationByCustomer, getOnbFile } from "@/lib/onboarding";
import { currentUser } from "@/lib/auth";
import { contentDisposition } from "@/lib/onb-file-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 온보딩 파일 스트리밍 — 소유 고객(onb_session) 또는 관리자(glovek_admin)만.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await getOnbFile(id);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 인가: 관리자거나, 파일이 속한 신청서의 소유 고객.
  let ok = false;
  const admin = await currentUser().catch(() => null);
  if (admin) ok = true;
  else {
    const c = await currentOnbCustomer().catch(() => null);
    if (c) {
      const app = await getApplicationByCustomer(c.id).catch(() => null);
      if (app && String(app.id) === f.application_id) ok = true;
    }
  }
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  // ?dl=1 이면 새 창 미리보기 대신 곧바로 저장되게 한다(어드민 다운로드 링크가 이 형태).
  //   파일명이 한글·공백이어도 깨지지 않게 filename* (RFC 5987) 을 함께 준다.
  const download = req.nextUrl.searchParams.get("dl") === "1";
  const disposition = contentDisposition(f.filename, download);

  return new NextResponse(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": download ? "application/octet-stream" : f.mime,
      "Content-Disposition": disposition,
      "Content-Length": String(f.bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
