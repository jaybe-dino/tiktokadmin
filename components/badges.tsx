import { PLAN_LABELS, STATE_LABELS, type Grade, type Plan, type State } from "@/lib/types";

export function GradeBadge({ grade }: { grade: Grade | null }) {
  if (!grade) return <span className="pill bg-gray-100 text-gray-400">·</span>;
  return <span className={`gr gr-${grade}`}>{grade}</span>;
}

export function StateBadge({ state }: { state: State }) {
  // .st-{state} 는 globals.css 프로토타입 색상표.
  return <span className={`pill st-${state}`}>{STATE_LABELS[state]}</span>;
}

export function PlanBadge({ plan }: { plan: Plan | null }) {
  if (!plan) return null;
  return <span className="pill" style={{ background: "#eef2ff", color: "#3730a3" }}>{PLAN_LABELS[plan]}</span>;
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
