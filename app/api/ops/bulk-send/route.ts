import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = new Set(["email", "sms", "both"]);

export async function POST(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const segment = String(body.segment ?? "").trim();
    if (!segment) {
      return NextResponse.json({ ok: false, error: "segment_required" }, { status: 400 });
    }

    const channel = String(body.channel ?? "email").trim();
    const safeChannel = CHANNELS.has(channel) ? channel : "email";
    const title = String(body.title ?? "").trim() || `일괄 발송 (${segment})`;
    const bodyMd = String(body.body_md ?? "").trim() || "";

    const row = await queryOne<{ id: string }>(
      `INSERT INTO bulk_sends (title, target_kind, target_def, channel, body_md, status, created_by)
       VALUES ($1, 'filter', $2::jsonb, $3, $4, 'draft', $5)
       RETURNING id`,
      [title, JSON.stringify({ segment }), safeChannel, bodyMd, user.id],
    );

    return NextResponse.json({ ok: true, id: row?.id ?? null });
  } catch {
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
