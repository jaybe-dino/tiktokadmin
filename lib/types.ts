// 전 시스템 공통 canonical enum (00-MASTER-PLAN 4-2). 임의 변경 금지.

export const STATES = [
  "lead_new", "seminar", "meeting", "contact", "contract_review",
  "contract_done", "docs", "setup", "live_mall", "live_onboarding",
  "settling", "dropped", "churned",
] as const;
export type State = (typeof STATES)[number];

export const STATE_LABELS: Record<State, string> = {
  lead_new: "리드확보",
  seminar: "세미나신청",
  meeting: "1:1미팅",
  contact: "개별컨택중",
  contract_review: "계약서검토",
  contract_done: "계약완료",
  docs: "서류수급중",
  setup: "입점셋업",
  live_mall: "운영중·멀티몰",
  live_onboarding: "운영중·온보딩",
  settling: "정산중",
  dropped: "드랍보류",
  churned: "해지",
};

/** 종료 상태 (칸반에서 접힌 컬럼) */
export const TERMINAL_STATES: State[] = ["dropped", "churned"];

export type ContractType = "mall" | "onboarding";

export const PLANS = ["live_focus_490k", "guarantee_1m", "onboarding_onetime", "pro_89k"] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_LABELS: Record<Plan, string> = {
  live_focus_490k: "Live Focus 49만(정기)",
  guarantee_1m: "Guarantee 100만(수기)",
  onboarding_onetime: "온보딩 일회(3~12M)",
  pro_89k: "Pro 8.9만(정기)",
};

export const PAY_STATUSES = ["none", "once_paid", "subscribed", "past_due", "canceled"] as const;
export type PayStatus = (typeof PAY_STATUSES)[number];

export const GRADES = ["S", "A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];

export type RecTrack = "onboarding" | "live";
export type ChurnRisk = "low" | "mid" | "high";

export const SOURCES = [
  "glovek_consult", "glovek_inquiry", "glovek_signup",
  "apply_consult", "apply_seminar", "apply_qna", "apply_smr",
  "tp_seminar", "tp_ebook", "referrer", "expo", "etc",
] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<string, string> = {
  glovek_consult: "Glovek 상담",
  glovek_inquiry: "Glovek 문의",
  glovek_signup: "Glovek 가입",
  apply_consult: "apply 상담",
  apply_seminar: "apply 세미나",
  apply_qna: "apply QnA",
  apply_smr: "apply SMR",
  tp_seminar: "tpartners 세미나",
  tp_ebook: "tpartners 전자책",
  referrer: "영업 직접",
  expo: "전시/팝업",
  etc: "기타",
};

export type Role = "intake" | "sales" | "onboard" | "ads" | "settle" | "lead" | "exec";
export type OwnerField = "owner_intake" | "owner_sales" | "owner_onboard" | "owner_ads";

/** brands 행 (읽기 모델). DB 컬럼과 1:1. */
export interface Brand {
  id: string;
  brand_name: string;
  brand_name_en: string;
  biz_no: string | null;
  email: string | null;
  phone: string | null;
  contact_name: string;
  category: string;
  brand_url: string;
  state: State;
  contract_type: ContractType | null;
  source: Source | string;
  plan: Plan | null;
  pay_status: PayStatus;
  countries: string[];
  grade: Grade | null;
  rec_track: RecTrack | null;
  churn_risk: ChurnRisk;
  brief_md: string | null;
  owner_intake: string | null;
  owner_sales: string | null;
  owner_onboard: string | null;
  owner_ads: string | null;
  next_action: string;
  due_date: string | null;
  last_contact_at: string | null;
  stage_entered_at: string;
  glovek_user_id: string | null;
  glovek_onb_id: string | null;
  apply_customer_id: number | null;
  apply_app_id: number | null;
  tp_registration_id: number | null;
  referral_code: string | null;
  memo: string;
  created_at: string;
  updated_at: string;
}

export type AlertKind = "sla_breach" | "gate_violation" | "doc_missing" | "pay_overdue" | "stale";
