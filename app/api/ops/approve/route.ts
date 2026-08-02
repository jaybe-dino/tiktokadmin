import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS = new Set(["approved", "rejected"]);

// 드랍/환불/정산 결재 처리. 결재선: lead·exec 만 허용.
export async function POST(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (user.role !== "lead" && user.role !== "exec") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const decision = String(body.decision ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
    }
    if (!DECISIONS.has(decision)) {
      return NextResponse.json({ ok: false, error: "invalid_decision" }, { status: 400 });
    }

    // pending 인 요청만 갱신 (중복 결재 방지). kind/brand_id 회수.
    const updated = await queryOne<{ kind: string; brand_id: string | null }>(
      `UPDATE approval_requests
          SET status=$2, decided_by=$3, decided_at=now()
        WHERE id=$1 AND status='pending'
      RETURNING kind, brand_id`,
      [id, decision, user.id],
    );

    if (!updated) {
      return NextResponse.json({ ok: false, error: "not_pending" }, { status: 409 });
    }

    // 승인 + 드랍 결재면 브랜드를 dropped 로 전이.
    // (게이트 검증 생략 — 결재 승인 자체가 승인선 통과로 간주)
    if (decision === "approved" && updated.kind === "drop" && updated.brand_id) {
      await query("UPDATE brands SET state='dropped' WHERE id=$1", [updated.brand_id]).catch(() => []);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
