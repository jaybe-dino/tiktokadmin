import { NextRequest, NextResponse } from "next/server";
import { portalSession, pq } from "@/lib/portal-db";
import { query } from "@/lib/db";
import { createTicket } from "@/lib/cs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 정산 이의 제기 (16 §2 / 17 §2) → settlements.disputed + CS 티켓.
export async function POST(req: NextRequest) {
  const s = await portalSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { settlement_id } = await req.json().catch(() => ({}));
  if (!settlement_id) return NextResponse.json({ error: "settlement_id 필요" }, { status: 400 });

  // 격리: 본인 브랜드 정산만.
  const rows = await pq<{ id: string; month: string }>(
    s.brand_id, "SELECT id::text, month FROM settlements WHERE brand_id=$1 AND id=$2", [settlement_id]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  await query("UPDATE settlements SET status='disputed' WHERE id=$1", [settlement_id]);
  await createTicket({
    brand_id: s.brand_id, channel: "portal", priority: "high",
    subject: `정산 이의 제기 (${String(rows[0].month).slice(0, 7)})`,
    body: "브랜드가 포털에서 정산 명세에 이의를 제기했습니다. 재계산 검토 필요.",
  });
  return NextResponse.json({ ok: true });
}
