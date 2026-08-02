"use server";

// mkt 화면 전용 서버액션. @/app/actions.ts 는 수정하지 않는다(충돌 방지).
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

const STATUSES = ["draft", "sent", "negotiating", "won", "dropped"] as const;
type MktStatus = (typeof STATUSES)[number];

export interface MktResult {
  ok: boolean;
  error?: string;
}

/**
 * 파이프라인 카드 이동 — mkt_projects.proposal_status 변경.
 * 게이트: 수주(won)로 이동하려면 해당 브랜드에 계약이 1건 이상 등록돼 있어야 한다
 *         (화면 안내 "수주→진행은 계약 등록이 필요합니다"와 일치).
 */
export async function setMktStatusAction(id: string, to: string): Promise<MktResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "세션 만료" };
  if (!STATUSES.includes(to as MktStatus)) return { ok: false, error: "잘못된 상태값" };

  const proj = await queryOne<{ brand_id: string }>(
    "SELECT brand_id FROM mkt_projects WHERE id=$1",
    [id],
  );
  if (!proj) return { ok: false, error: "프로젝트를 찾을 수 없습니다." };

  if (to === "won") {
    const c = await queryOne<{ n: string }>(
      "SELECT count(*)::text AS n FROM contracts WHERE brand_id=$1",
      [proj.brand_id],
    );
    if (!c || Number(c.n) === 0) {
      return { ok: false, error: "수주로 이동하려면 계약 등록이 필요합니다 (브랜드 카드에서 계약 추가)." };
    }
  }

  await query(
    "UPDATE mkt_projects SET proposal_status=$2, updated_at=now() WHERE id=$1",
    [id, to],
  );
  revalidatePath("/mkt");
  return { ok: true };
}
