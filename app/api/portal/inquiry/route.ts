import { NextRequest, NextResponse } from "next/server";
import { portalSession } from "@/lib/portal-db";
import { createTicket } from "@/lib/cs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 포털 문의 접수 (16 §2) → cs_tickets(channel='portal').
export async function POST(req: NextRequest) {
  const s = await portalSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { subject, body } = await req.json().catch(() => ({}));
  if (!subject) return NextResponse.json({ error: "제목 필요" }, { status: 400 });
  await createTicket({ brand_id: s.brand_id, channel: "portal", subject, body: body ?? "" });
  return NextResponse.json({ ok: true });
}
