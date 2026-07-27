import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/ops-auth";
import { opsManualPayment } from "@/lib/ops";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = await resolveActor(req, body);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await opsManualPayment(actor, {
    brand_id: String(body.brand_id ?? ""),
    plan: String(body.plan ?? ""),
    amount: Number(body.amount ?? 0),
    paid_at: String(body.paid_at ?? ""),
    next_due: body.next_due as string | undefined,
    note: body.note as string | undefined,
  });
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
