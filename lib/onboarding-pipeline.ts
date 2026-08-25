// 온보딩 파이프라인 — 온보딩·제품 파트 전용 보드 데이터.
//   온보딩 신청서가 맵핑된 브랜드만 노출한다(영업 단계 무관, 드랍·해지 제외).
//   신청서만 생성(담당 미배정)=서류수급, 온보딩 담당 배정 시=입점셋업 으로 파생하고,
//   이후 승인·제품등록·운영개시로 5단계(서류수급 · 입점셋업 · 가입완료 · 제품등록 · 운영준비)를 파생한다.
//   onb_stage_override='hold' 는 '보류' 섹터로 분리한다(단계 파생과 무관).
import { query } from "./db";
import { businessDaysBetween } from "./time";

export type OnbStageKey = "invite" | "company" | "signup" | "product" | "ready";

export const ONB_STAGES: { key: OnbStageKey; label: string; slaDays: number | null; desc: string }[] = [
  { key: "invite", label: "서류수급", slaDays: 5, desc: "온보딩 신청서 접수 — 온보딩 담당 배정 대기" },
  { key: "company", label: "입점 셋업", slaDays: 3, desc: "온보딩 담당 배정됨 — 기업정보 입력·검토·셋업 진행" },
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
  overridden: boolean; // 담당자가 수동으로 단계 이동한 상태(보류 제외)
  held: boolean;       // 보류 섹터로 이동된 상태
  app_status: string | null;
  product_count: number;
  anchor_at: string;   // SLA 경과 기준시각
  ageDays: number;
  overSla: boolean;
}

const STAGE_KEYS = new Set<string>(ONB_STAGES.map((s) => s.key));

interface OnbBoardData {
  groups: Record<OnbStageKey, OnbCard[]>;
  held: OnbCard[];
}

/** 온보딩 보드 데이터 — 단계별 그룹 + 보류 섹터. */
export async function onboardingBoardData(): Promise<OnbBoardData> {
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
       JOIN LATERAL (
         SELECT x.id, x.status, x.updated_at
           FROM onb_applications x
           LEFT JOIN onb_customers cu ON cu.id = x.customer_id
          WHERE COALESCE(x.brand_id, cu.brand_id) = b.id
          ORDER BY x.created_at DESC LIMIT 1
       ) a ON true
      -- 노출 기준: 온보딩 신청서가 맵핑된 브랜드는 영업 단계와 무관하게 전부 표시(드랍·해지만 제외).
      -- 상태(운영중) 필터를 걸었더니 신청서 있는 팀이 사라지는 문제가 있어 신청서 존재만을 기준으로 한다.
      WHERE b.state NOT IN ('dropped','churned')
      ORDER BY b.stage_entered_at ASC
      LIMIT 1000`;
  // 마이그레이션 0081 미적용(override 컬럼 없음) 시에도 데이터가 사라지지 않도록 폴백.
  const rows = await query<Row>(build(true)).catch(() => query<Row>(build(false)).catch(() => [] as Row[]));

  const now = Date.now();
  const out: Record<OnbStageKey, OnbCard[]> = { invite: [], company: [], signup: [], product: [], ready: [] };
  const held: OnbCard[] = [];
  for (const r of rows) {
    // 자동 파생 단계 — 신청서만(담당 미배정)=서류수급, 담당 배정 시=입점셋업.
    const derived: OnbStageKey =
      r.state === "live_onboarding" ? "ready"
      : r.app_status === "approved" ? (r.product_count > 0 ? "product" : "signup")
      : r.owner_onboard ? "company"
      : "invite";
    const isHeld = r.onb_stage_override === "hold";
    // 수동 오버라이드(보류 제외)가 유효하면 우선 적용.
    const overridden = !isHeld && !!r.onb_stage_override && STAGE_KEYS.has(r.onb_stage_override);
    const stage: OnbStageKey = overridden ? (r.onb_stage_override as OnbStageKey) : derived;
    const anchor = isHeld
      ? (r.onb_stage_override_at ?? r.stage_entered_at)
      : overridden
        ? (r.onb_stage_override_at ?? r.stage_entered_at)
        : (stage === "invite" ? r.stage_entered_at : (r.app_updated ?? r.stage_entered_at));
    const ageDays = businessDaysBetween(new Date(anchor), new Date(now));
    const sla = isHeld ? null : (ONB_STAGES.find((s) => s.key === stage)?.slaDays ?? null);
    const card: OnbCard = {
      brand_id: r.brand_id, brand_name: r.brand_name, state: r.state, owner_onboard: r.owner_onboard,
      stage, overridden, held: isHeld, app_status: r.app_status, product_count: r.product_count,
      anchor_at: anchor, ageDays, overSla: sla != null && ageDays > sla,
    };
    if (isHeld) held.push(card);
    else out[stage].push(card);
  }
  return { groups: { ...empty, ...out }, held };
}

/** 단계별 그룹만 반환(보류 제외) — today 요약 등 기존 호출부 호환용. */
export async function onboardingPipeline(): Promise<Record<OnbStageKey, OnbCard[]>> {
  const { groups } = await onboardingBoardData();
  return groups;
}
