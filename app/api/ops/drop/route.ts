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
  if (res.ok) return NextResponse.json({ ok: true, brand: res.brand });
  return NextResponse.json({ ok: false, error: res.error }, { status: res.needReason ? 422 : 400 });
}
