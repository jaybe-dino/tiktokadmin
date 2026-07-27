import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/ops-auth";
import { opsTransition } from "@/lib/ops";
import type { State } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = await resolveActor(req, body);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await opsTransition(actor, {
    brand_id: String(body.brand_id ?? ""),
    to_state: body.to_state as State,
    reason: body.reason as string | undefined,
  });

  if (res.ok) return NextResponse.json({ ok: true, brand: res.brand });
  if (res.failed) return NextResponse.json({ ok: false, failed: res.failed, error: res.error }, { status: 422 });
  if (res.needReason) return NextResponse.json({ ok: false, needReason: true, error: res.error }, { status: 422 });
  return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
}
