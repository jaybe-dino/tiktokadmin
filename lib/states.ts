import type { OwnerField, Role, State } from "./types";

// 상태 머신 (03-GATES-SLA §1). 허용 전이·퍼널 순서·담당 매핑.

/** 허용 전이(전진). dropped/churned/hold 는 별도 규칙.
 *  docs/setup 은 폐지된 레거시 상태(계약완료 → 운영중 직행) — 신규 전이는 발생하지 않는다. */
export const FORWARD_TRANSITIONS: Record<State, State[]> = {
  lead_new: ["seminar", "meeting", "contact"],
  seminar: ["meeting", "contact"],
  meeting: ["contact"],
  contact: ["contract_review", "contract_done"],
  contract_review: ["contract_done"],
  contract_done: ["live_mall", "live_onboarding"],
  docs: [], // 폐지 — 레거시 데이터만 존재 가능(마이그레이션 0085 로 운영중 이관)
  setup: [], // 폐지 — 상동
  live_mall: ["settling"],
  live_onboarding: ["settling"],
  settling: [],
  // 드랍 복귀는 isTransitionAllowed 에서 명시 처리(사유 필수) — 표는 전진 전이만 담는다.
  dropped: [],
  churned: [],
  // 보류 해제는 isTransitionAllowed 에서 명시 처리(어느 단계로든 복귀). 표는 참고용.
  hold: ["lead_new", "seminar", "meeting", "contact", "contract_review", "contract_done", "docs", "setup", "live_mall", "live_onboarding", "settling"],
};

/** 퍼널 서열 (전진 판정용). 종료 상태·보류·폐지된 docs/setup 은 -1(서열 밖). */
const ORDINAL: Record<State, number> = {
  lead_new: 0,
  seminar: 1,
  meeting: 2,
  contact: 3,
  contract_review: 4,
  contract_done: 5,
  docs: -1, // 폐지 — 레거시 데이터 전용
  setup: -1, // 폐지 — 상동
  live_mall: 6,
  live_onboarding: 6,
  settling: 7,
  dropped: -1,
  churned: -1,
  hold: -1, // 파이프라인 서열 밖 — 진입/해제는 isTransitionAllowed 명시 처리.
};

export function ordinal(s: State): number {
  return ORDINAL[s];
}

/** a 가 b 보다 퍼널상 뒤(전진)인가 */
export function isAhead(a: State, b: State): boolean {
  return ORDINAL[a] > ORDINAL[b];
}

/** dropped 는 어디서든 가능, churned 는 live_*·settling 에서만. */
export function canTerminate(from: State, to: "dropped" | "churned"): boolean {
  if (to === "dropped") return from !== "dropped" && from !== "churned";
  return from === "live_mall" || from === "live_onboarding" || from === "settling";
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
    return {
      allowed: ok,
      requiresReason: true,
      reason: ok ? undefined : `${from}에서 ${to} 불가`,
    };
  }

  // 보류 진입: 종료 상태를 제외한 어느 단계에서든 가능 — 단 사유(메모) 필수(예: 추후 재컨택 / 완전 보류).
  if (to === "hold") {
    const ok = from !== "dropped" && from !== "churned";
    return { allowed: ok, requiresReason: true, reason: ok ? undefined : `${from}에서 보류 불가` };
  }
  // 보류 해제: 파이프라인 어느 단계로든 복귀(사유 불필요). dropped/churned 는 위에서 처리됨.
  if (from === "hold") {
    return { allowed: true, requiresReason: false };
  }

  // 드랍 복귀(재활성) — 연락이 끊겨 드랍했던 건이 다시 연락·미팅으로 이어지는 경우,
  //   영업 파이프라인으로 되돌린다(BUG-28). 되살리는 이동이므로 사유는 필수(감사 기록).
  //   대상은 퍼널 서열 안의 단계만 — 폐지된 docs/setup·종료 상태로는 복귀하지 않는다.
  if (from === "dropped") {
    const ok = ORDINAL[to] >= 0;
    return { allowed: ok, requiresReason: true, reason: ok ? undefined : `드랍에서 ${to} 로 복귀할 수 없습니다.` };
  }

  // 전진: 허용 전이표
  if (FORWARD_TRANSITIONS[from].includes(to)) {
    return { allowed: true, requiresReason: false };
  }

  // 후퇴(퍼널 앞 방향): lead|exec 만, 사유 필수
  if (ORDINAL[to] >= 0 && ORDINAL[from] >= 0 && ORDINAL[to] < ORDINAL[from]) {
    const ok = role === "lead" || role === "exec";
    return {
      allowed: ok,
      requiresReason: true,
      reason: ok ? undefined : "후퇴 전이는 파트장/대표만 가능",
    };
  }

  return { allowed: false, requiresReason: false, reason: "허용되지 않는 전이" };
}

/** 상태 구간의 주 담당 필드 (핸드오프·게이트 assigned 판정). */
export function ownerFieldForState(s: State): OwnerField | null {
  switch (s) {
    case "lead_new":
    case "seminar":
    case "meeting":
      return "owner_intake";
    case "contact":
    case "contract_review":
    case "contract_done":
      return "owner_sales";
    case "docs":
    case "setup":
      return "owner_onboard";
    case "live_mall":
    case "live_onboarding":
    case "settling":
      return "owner_ads";
    default:
      return null;
  }
}

/** 역할 → 담당 필드 */
export function ownerFieldForRole(role: Role): OwnerField | null {
  switch (role) {
    case "intake":
      return "owner_intake";
    case "sales":
      return "owner_sales";
    case "onboard":
      return "owner_onboard";
    case "ads":
      return "owner_ads";
    default:
      return null; // settle/lead/exec 은 브랜드 담당 필드 없음
  }
}
