import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getBugReportImage } from "@/lib/bug-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 기능오류 제보 스크린샷 스트리밍 — 관리자만.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await currentUser().catch(() => null);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const f = await getBugReportImage(id);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": f.mime || "image/png",
      "Content-Disposition": `inline; filename="bug-${id}.png"`,
      "Cache-Control": "private, no-store",
    },
  });
}
