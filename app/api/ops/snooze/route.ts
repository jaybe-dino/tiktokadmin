import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/ops-auth";
import { opsSnooze } from "@/lib/ops";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = await resolveActor(req, body);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await opsSnooze(actor, {
    alert_id: String(body.alert_id ?? ""),
    until: String(body.until ?? new Date(Date.now() + 86_400_000).toISOString()),
  });
  return NextResponse.json(res);
}
