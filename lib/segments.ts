// 캠페인 세그먼트 정의 (단일 출처) — /campaigns 카운트와 /api/ops/bulk-send 대상 산정이
//   같은 WHERE 를 쓰도록 공유. 테스트 브랜드(is_test)는 대상에서 제외.
import { queryOne } from "./db";

export interface Segment { key: string; title: string; where: string }

export const SEGMENTS: Record<string, Segment> = {
  winback: { key: "winback", title: "윈백(드랍 재접촉)", where: "state = 'dropped'" },
  seminar: { key: "seminar", title: "담당자배정 미전환 90일+", where: "state = 'seminar' AND stage_entered_at < now() - interval '90 days'" },
  expand: { key: "expand", title: "운영중 국가추가 후보", where: "state IN ('live_mall','live_onboarding') AND coalesce(array_length(countries,1),0) BETWEEN 1 AND 2" },
  pastdue: { key: "pastdue", title: "past_due 재접촉", where: "pay_status = 'past_due'" },
};

/** 세그먼트 대상 브랜드 수(테스트 제외). 알 수 없는 키는 0. */
export async function segmentCount(key: string): Promise<number> {
  const seg = SEGMENTS[key];
  if (!seg) return 0;
  const r = await queryOne<{ c: string }>(
    `SELECT count(*)::text c FROM brands WHERE coalesce(is_test,false)=false AND (${seg.where})`).catch(() => null);
  return Number(r?.c ?? 0);
}
