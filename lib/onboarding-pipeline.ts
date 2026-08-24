// 온보딩 파이프라인 — 온보딩·제품 파트 전용 보드 데이터.
//   영업 파이프라인의 '서류수급(docs)' 진입 브랜드부터, 온보딩 신청(onb_applications) 진행상태로
//   5단계(서류준비/invite · 기업정보등록 · 가입완료 · 제품등록 · 운영준비)를 파생한다.
import { query } from "./db";
import { businessDaysBetween } from "./time";

export type OnbStageKey = "invite" | "company" | "signup" | "product" | "ready";

export const ONB_STAGES: { key: OnbStageKey; label: string; slaDays: number | null; desc: string }[] = [
  { key: "invite", label: "서류준비 / Invite", slaDays: 5, desc: "온보딩 계정(초대) 발급·서류 준비 — 다음 단계는 invite 발급 후" },
  { key: "company", label: "기업정보 등록", slaDays: 3, desc: "고객 정보 입력·검토 — 승인되면 다음 단계" },
  { key: "signup", label: "가입 완료", slaDays: 7, desc: "승인 완료 — 다음 단계로 진행" },
  { key: "product", label: "제품 등록", slaDays: 7, desc: "담당자 제품 등록" },
  { key: "ready", label: "운영 준비", slaDays: null, desc: "운영 준비 완료" },
];

export interface OnbCard {
  brand_id: string;
  brand_name: string;
  state: string;
  owner_onboard: string | null;
  stage: OnbStageKey;
  overridden: boolean; // 담당자가 수동으로 단계 이동한 상태
  app_status: string | null;
  product_count: number;
  anchor_at: string;   // SLA 경과 기준시각
  ageDays: number;
  overSla: boolean;
}

const STAGE_KEYS = new Set<string>(ONB_STAGES.map((s) => s.key));

export async function onboardingPipeline(): Promise<Record<OnbStageKey, OnbCard[]>> {
  const empty: Record<OnbStageKey, OnbCard[]> = { invite: [], company: [], signup: [], product: [], ready: [] };
  type Row = {
    brand_id: string; brand_name: string; state: string; owner_onboard: string | null; stage_entered_at: string;
    onb_stage_override: string | null; onb_stage_override_at: string | null;
    app_id: string | null; app_status: string | null; app_updated: string | null; product_count: number;
  };
  const build = (overrideCols: boolean) =>
    `SELECT b.id AS brand_id, b.brand_name, b.state, b.owner_onboard, b.stage_entered_at,
            ${overrideCols ? "b.onb_stage_override, b.onb_stage_override_at," : "NULL::text AS onb_stage_override, NULL::timestamptz AS onb_stage_override_at,"}
            a.id AS app_id, a.status AS app_status, a.updated_at AS app_updated,
            COALESCE((SELECT count(*) FROM onb_products p WHERE p.application_id=a.id),0)::int AS product_count
       FROM brands b
       LEFT JOIN LATERAL (
         SELECT id, status, updated_at FROM onb_applications x WHERE x.brand_id=b.id ORDER BY created_at DESC LIMIT 1
       ) a ON true
      WHERE b.state IN ('contract_done','docs','setup','live_onboarding')
         OR a.id IS NOT NULL
      ORDER BY b.stage_entered_at ASC
      LIMIT 500`;
  // 마이그레이션 0081 미적용(override 컬럼 없음) 시에도 데이터가 사라지지 않도록 폴백.
  const rows = await query<Row>(build(true)).catch(() => query<Row>(build(false)).catch(() => [] as Row[]));

  const now = Date.now();
  const out: Record<OnbStageKey, OnbCard[]> = { invite: [], company: [], signup: [], product: [], ready: [] };
  for (const r of rows) {
    // 자동 파생 단계.
    const derived: OnbStageKey =
      r.state === "live_onboarding" ? "ready"
      : !r.app_id ? "invite"
      : r.app_status === "approved" ? (r.product_count > 0 ? "product" : "signup")
      : "company"; // draft|submitted|rejected = 기업정보 등록/검토
    // 수동 오버라이드가 유효하면 우선 적용(드래그앤드롭으로 이동한 단계).
    const overridden = !!r.onb_stage_override && STAGE_KEYS.has(r.onb_stage_override);
    const stage: OnbStageKey = overridden ? (r.onb_stage_override as OnbStageKey) : derived;
    const anchor = overridden
      ? (r.onb_stage_override_at ?? r.stage_entered_at)
      : (stage === "invite" ? r.stage_entered_at : (r.app_updated ?? r.stage_entered_at));
    const ageDays = businessDaysBetween(new Date(anchor), new Date(now));
    const sla = ONB_STAGES.find((s) => s.key === stage)?.slaDays ?? null;
    out[stage].push({
      brand_id: r.brand_id, brand_name: r.brand_name, state: r.state, owner_onboard: r.owner_onboard,
      stage, overridden, app_status: r.app_status, product_count: r.product_count,
      anchor_at: anchor, ageDays, overSla: sla != null && ageDays > sla,
    });
  }
  return { ...empty, ...out };
}
