import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getApplicationByCustomer } from "@/lib/onboarding";
import { buildLoaPdf } from "@/lib/loa-pdf";

// LOA 수권서 PDF 자동 다운로드. 대시 세션 필수(KYC 보호).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const u = await currentUser().catch(() => null);
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { customerId } = await params;
  const app = await getApplicationByCustomer(customerId);
  if (!app) return NextResponse.json({ error: "신청서를 찾을 수 없습니다." }, { status: 404 });
  if (!String(app.ubo_signature_data ?? "").trim()) return NextResponse.json({ error: "아직 대표자 서명(LOA)이 없습니다." }, { status: 422 });

  try {
    const pdf = await buildLoaPdf(app);
    const brand = String(app.shop_name_en || app.company_name_en || "brand").replace(/[^\w.-]+/g, "_").slice(0, 40) || "brand";
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="LOA_${brand}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `PDF 생성 실패: ${(e as Error).message}` }, { status: 500 });
  }
}
