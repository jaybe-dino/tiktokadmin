import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { transitionBrand } from "@/lib/transition";

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

    // 승인 + 드랍 결재면 단일 전이 경로(transitionBrand)로 dropped 처리 —
    //   stage_history 기록 + stage_entered_at 갱신 + SLA/게이트/stale 알림 해제까지 동반.
    //   raw UPDATE 로 우회하면 드랍 브랜드의 sla_breach 알림이 영구 미해제되어 지표가 오염됨.
    // (refund/settlement 는 기록용 승인 — 실제 정산 확정은 /settlements, 환불은 /pay 경유)
    // kind='discount'(제안서 할인 20% 초과)도 승인 기록만 — 제안서 생성·발송은 담당이 진행.
    if (decision === "approved" && updated.kind === "drop" && updated.brand_id) {
      await transitionBrand({
        brandId: updated.brand_id, to: "dropped",
        actor: `admin:${user.id}`, actorRole: user.role,
        reason: "결재 승인(드랍)",
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
