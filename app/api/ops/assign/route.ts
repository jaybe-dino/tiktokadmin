import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/ops-auth";
import { opsAssign } from "@/lib/ops";
import type { OwnerField } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const actor = await resolveActor(req, body);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await opsAssign(actor, {
    brand_id: String(body.brand_id ?? ""),
    role: body.role as OwnerField,
    admin_user_id: String(body.admin_user_id ?? ""),
  });
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
