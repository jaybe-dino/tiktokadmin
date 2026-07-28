import { ENTRY_STATES, type OwnerField, type Role, type State } from "./types";

// 상태 머신 v2 (실제 운영 퍼널). 허용 전이·퍼널 순서·담당 매핑.

/** 허용 전이(전진). dropped/churned 는 별도 규칙. */
export const FORWARD_TRANSITIONS: Record<State, State[]> = {
  // 유입(병렬 진입) → 미팅/컨택
  inquiry: ["meeting", "contact"],
  seminar: ["meeting", "contact"],
  expo: ["meeting", "contact"],
  // 영업
  meeting: ["contact"],
  contact: ["contract_review", "contract_done"],
  contract_review: ["contract_done"],
  // 계약
  contract_done: ["setup"],
  // 계약 이후
  setup: ["live"],
  live: ["settling"],
  settling: [],
  // 종료
  dropped: [],
  churned: [],
};

/** 퍼널 서열 (전진 판정용). 유입 3종은 동일 서열 0. 종료 -1. */
const ORDINAL: Record<State, number> = {
  inquiry: 0, seminar: 0, expo: 0,
  meeting: 1,
  contact: 2,
  contract_review: 3,
  contract_done: 4,
  setup: 5,
  live: 6,
  settling: 7,
  dropped: -1, churned: -1,
};

export function ordinal(s: State): number {
  return ORDINAL[s];
}

/** a 가 b 보다 퍼널상 뒤(전진)인가 */
export function isAhead(a: State, b: State): boolean {
  return ORDINAL[a] > ORDINAL[b];
}

/** dropped 는 어디서든, churned 는 live·settling 에서만. */
export function canTerminate(from: State, to: "dropped" | "churned"): boolean {
  if (to === "dropped") return from !== "dropped" && from !== "churned";
  return from === "live" || from === "settling";
}

/** 전이가 구조적으로 허용되는지(게이트 조건은 별도). */
export function isTransitionAllowed(
  from: State,
  to: State,
  role?: Role,
): { allowed: boolean; requiresReason: boolean; reason?: string } {
  if (from === to) return { allowed: false, requiresReason: false, reason: "동일 상태" };

  if (to === "dropped" || to === "churned") {
    const ok = canTerminate(from, to);
    return { allowed: ok, requiresReason: true, reason: ok ? undefined : `${from}에서 ${to} 불가` };
  }

  // 유입 상태끼리 전환 허용(문의↔세미나↔박람회) — 같은 서열, 사유 불필요
  if (ENTRY_STATES.includes(from) && ENTRY_STATES.includes(to)) {
    return { allowed: true, requiresReason: false };
  }

  if (FORWARD_TRANSITIONS[from].includes(to)) {
    return { allowed: true, requiresReason: false };
  }

  // 후퇴: lead|exec 만, 사유 필수
  if (ORDINAL[to] >= 0 && ORDINAL[from] >= 0 && ORDINAL[to] < ORDINAL[from]) {
    const ok = role === "lead" || role === "exec";
    return { allowed: ok, requiresReason: true, reason: ok ? undefined : "후퇴 전이는 파트장/대표만 가능" };
  }

  return { allowed: false, requiresReason: false, reason: "허용되지 않는 전이" };
}

/** 상태 구간의 주 담당 필드. */
export function ownerFieldForState(s: State): OwnerField | null {
  switch (s) {
    case "inquiry":
    case "seminar":
    case "expo":
    case "meeting":
      return "owner_intake";
    case "contact":
    case "contract_review":
    case "contract_done":
      return "owner_sales";
    case "setup":
      return "owner_onboard";
    case "live":
    case "settling":
      return "owner_ads";
    default:
      return null;
  }
}

/** 역할 → 담당 필드 */
export function ownerFieldForRole(role: Role): OwnerField | null {
  switch (role) {
    case "intake": return "owner_intake";
    case "sales": return "owner_sales";
    case "onboard": return "owner_onboard";
    case "ads": return "owner_ads";
    default: return null;
  }
}
