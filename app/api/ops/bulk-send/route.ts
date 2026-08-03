import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { SEGMENTS, segmentCount } from "@/lib/segments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = new Set(["email", "sms", "both"]);

// [AI 초안] kind='draft' → 초안(status='draft'). [발송] kind='send' → 발송 예약(status='queued').
//   두 버튼이 서로 다른 상태를 만들고, 실제 대상 수(queued)를 반환한다.
//   중복 방지: 같은 세그먼트의 draft/queued 가 이미 있으면 재사용(누적 방지).
//   실제 발송은 승인(결재)·발송 워커 경유 — 여기선 대상 확정·예약까지.
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
    if (!SEGMENTS[segment]) {
      return NextResponse.json({ ok: false, error: "unknown_segment" }, { status: 400 });
    }

    const channel = String(body.channel ?? "email").trim();
    const safeChannel = CHANNELS.has(channel) ? channel : "email";
    const kind = String(body.kind ?? "draft").trim();
    const status = kind === "send" ? "queued" : "draft";
    const title = `${SEGMENTS[segment].title}${kind === "send" ? "" : " (AI 초안)"}`;
    const bodyMd = String(body.body_md ?? "").trim() || "";

    const queued = await segmentCount(segment);

    // 중복 방지 — 같은 세그먼트·상태의 미완료 캠페인이 있으면 대상수만 갱신하고 재사용.
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM bulk_sends
        WHERE target_kind='filter' AND status=$2 AND target_def->>'segment'=$1
        ORDER BY created_at DESC LIMIT 1`,
      [segment, status]).catch(() => null);
    if (existing) {
      await queryOne("UPDATE bulk_sends SET total=$2 WHERE id=$1", [existing.id, queued]).catch(() => null);
      return NextResponse.json({ ok: true, id: existing.id, status, queued, reused: true });
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO bulk_sends (title, target_kind, target_def, channel, body_md, status, total, created_by)
       VALUES ($1, 'filter', $2::jsonb, $3, $4, $5, $6, $7)
       RETURNING id`,
      [title, JSON.stringify({ segment }), safeChannel, bodyMd, status, queued, user.id],
    );

    return NextResponse.json({ ok: true, id: row?.id ?? null, status, queued });
  } catch {
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
