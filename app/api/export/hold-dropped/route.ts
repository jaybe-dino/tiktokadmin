// 장기 보류 자동 드랍 목록 CSV (BUG-29) — 플로우링크 전달용.
//   보류 재컨택 라인에서 14영업일이 지나 시스템이 자동 드랍한 건만 모아 내려준다
//   (담당자가 직접 드랍한 건은 제외 — stage_history 사유로 구분).
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { HOLD_DROP_REASON } from "@/lib/sla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const u = await currentUser().catch(() => null);
  if (!u) return NextResponse.json({ error: "세션 만료" }, { status: 401 });
  // 최근 N일(기본 90일) 안에 자동 드랍된 건.
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 90) || 90));

  const rows = await query<{
    brand_name: string; contact_name: string | null; email: string | null; phone: string | null;
    source: string | null; owner_sales: string | null; dropped_at: string; reason: string | null;
  }>(
    `SELECT b.brand_name, b.contact_name, b.email, b.phone, b.source, b.owner_sales,
            sh.at AS dropped_at, sh.reason
       FROM stage_history sh
       JOIN brands b ON b.id = sh.brand_id
      WHERE sh.to_state='dropped' AND sh.actor='system:sla'
        AND sh.reason LIKE $1
        AND sh.at > now() - ($2 || ' days')::interval
      ORDER BY sh.at DESC`,
    [`%${HOLD_DROP_REASON}%`, days],
  ).catch(() => []);

  const header = ["브랜드명", "담당자", "이메일", "연락처", "유입경로", "영업담당", "드랍일시", "사유"];
  const body = rows.map((r) => [
    r.brand_name, r.contact_name, r.email, r.phone, r.source, r.owner_sales,
    new Date(r.dropped_at).toLocaleString("ko-KR"), r.reason,
  ].map(cell).join(","));
  // 엑셀에서 한글이 깨지지 않도록 BOM 포함.
  const csv = "﻿" + [header.join(","), ...body].join("\n");
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hold-dropped-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
