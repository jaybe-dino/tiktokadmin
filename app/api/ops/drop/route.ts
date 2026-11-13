import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/ops-auth";
import { opsDrop } from "@/lib/ops";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = await resolveActor(req, body);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await opsDrop(actor, {
    brand_id: String(body.brand_id ?? ""),
    reason: String(body.reason ?? ""),
  });
  // BUG-3: 결재권한이 없으면 요청만 등록된다 — 드랍된 것처럼 응답하면 안 된다.
  if (res.ok && res.pending) return NextResponse.json({ ok: true, pending: true, status: "awaiting_approval" });
  if (res.ok) return NextResponse.json({ ok: true, pending: false, brand: res.brand });
  return NextResponse.json({ ok: false, error: res.error }, { status: res.needReason ? 422 : 400 });
}
