import { PLAN_LABELS, STATE_LABELS, type Grade, type Plan, type State } from "@/lib/types";

const GRADE_COLORS: Record<string, string> = {
  S: "bg-purple-100 text-purple-700",
  A: "bg-blue-100 text-blue-700",
  B: "bg-amber-100 text-amber-700",
  C: "bg-gray-100 text-gray-600",
};

export function GradeBadge({ grade }: { grade: Grade | null }) {
  if (!grade) return <span className="pill bg-gray-100 text-gray-400">·</span>;
  return <span className={`pill ${GRADE_COLORS[grade]}`}>{grade}</span>;
}

const STATE_COLORS: Record<string, string> = {
  lead_new: "bg-gray-100 text-gray-600",
  seminar: "bg-sky-100 text-sky-700",
  meeting: "bg-sky-100 text-sky-700",
  contact: "bg-indigo-100 text-indigo-700",
  contract_review: "bg-violet-100 text-violet-700",
  contract_done: "bg-violet-100 text-violet-700",
  docs: "bg-amber-100 text-amber-700",
  setup: "bg-amber-100 text-amber-700",
  live_mall: "bg-emerald-100 text-emerald-700",
  live_onboarding: "bg-emerald-100 text-emerald-700",
  settling: "bg-teal-100 text-teal-700",
  dropped: "bg-gray-200 text-gray-500",
  churned: "bg-red-100 text-red-600",
};

export function StateBadge({ state }: { state: State }) {
  return <span className={`pill ${STATE_COLORS[state] ?? "bg-gray-100"}`}>{STATE_LABELS[state]}</span>;
}

export function PlanBadge({ plan }: { plan: Plan | null }) {
  if (!plan) return null;
  return <span className="pill bg-pink/10 text-pink">{PLAN_LABELS[plan]}</span>;
}

const PAY_COLORS: Record<string, string> = {
  none: "bg-gray-100 text-gray-500",
  once_paid: "bg-emerald-100 text-emerald-700",
  subscribed: "bg-emerald-100 text-emerald-700",
  past_due: "bg-red-100 text-red-600",
  canceled: "bg-gray-200 text-gray-500",
};

export function PayBadge({ status }: { status: string }) {
  return <span className={`pill ${PAY_COLORS[status] ?? "bg-gray-100"}`}>{status}</span>;
}

export function TierBadge({ tier }: { tier: number }) {
  const c = tier >= 3 ? "bg-red-600 text-white" : tier >= 2 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700";
  return <span className={`pill ${c}`}>T{tier}</span>;
}
