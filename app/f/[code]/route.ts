import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 쇼트링크 리다이렉트 — 공개 경로(수신자가 클릭, 로그인 불필요 · middleware 예외).
//   조회 → 302 리다이렉트 + clicks 증가 + link_clicks(UA) 기록. 없으면 404.
//   커스텀 도메인 file.glovek.space 는 Vercel 도메인 연결 + SHORTLINK_BASE env 로
//   이 경로를 그대로 서빙(도메인만 바뀜) — 코드 변경 불필요.
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code: raw } = await ctx.params;
  const code = raw.trim();
  if (!code || code.length > 32) return new NextResponse("Not Found", { status: 404 });

  const row = await queryOne<{ target_url: string }>(
    "SELECT target_url FROM short_links WHERE code=$1", [code],
  ).catch(() => null);
  if (!row?.target_url) return new NextResponse("Not Found", { status: 404 });

  // 트래킹 실패가 리다이렉트를 막지 않도록 개별 catch
  const ua = req.headers.get("user-agent");
  await Promise.all([
    query("UPDATE short_links SET clicks=clicks+1 WHERE code=$1", [code]).catch(() => {}),
    query("INSERT INTO link_clicks (code, ua) VALUES ($1,$2)", [code, ua ?? null]).catch(() => {}),
  ]);

  return NextResponse.redirect(row.target_url, 302);
}
