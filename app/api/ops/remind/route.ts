import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/ops-auth";
import { opsRemind } from "@/lib/ops";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = await resolveActor(req, body);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await opsRemind(actor, {
    brand_id: String(body.brand_id ?? ""),
    channel: (body.channel as "email" | "sms") ?? "email",
    override_body: body.override_body as string | undefined,
  });
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
