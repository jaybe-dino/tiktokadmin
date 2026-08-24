// 전역 검색 API — 상단 검색창(인라인). 세션 보호.
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { globalSearch } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await currentUser().catch(() => null);
  if (!u) return NextResponse.json({ ok: false, hits: [] }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const hits = await globalSearch(q).catch(() => []);
  return NextResponse.json({ ok: true, hits });
}
