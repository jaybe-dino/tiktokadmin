// 외부 열람자 CSV 내려받기. 기본은 꺼져 있고(allow_download=false) 관리자가 켜야 열린다.
//   세션이 가리키는 행사만 내보내고, 노출 항목은 관리자가 고른 것만 들어간다.
import { NextRequest, NextResponse } from "next/server";
import { shareViewFor, readRoster } from "@/lib/seminar-event-share";
import { csvDoc } from "@/lib/seminar-events-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await shareViewFor(token).catch(() => null);
  if (!view) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!view.allowDownload) return NextResponse.json({ error: "download disabled" }, { status: 403 });

  const data = await readRoster(view, 2000);
  const csv = csvDoc(
    ["번호", ...data.headers.map((h) => h.label)],
    data.rows.map((r, i) => [i + 1, ...r.cells.map((c) => c.value)]),
  );
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="roster-${today}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
