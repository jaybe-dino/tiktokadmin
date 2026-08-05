import { NextRequest, NextResponse } from "next/server";
import { currentOnbCustomer, getApplicationByCustomer, getOnbFile } from "@/lib/onboarding";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 온보딩 파일 스트리밍 — 소유 고객(onb_session) 또는 관리자(glovek_admin)만.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  return new NextResponse(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": f.mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.filename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
