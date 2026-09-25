// 광고 수신거부 "범위" 안내 문구 — DB 를 부르지 않는다.
//   "use client" 화면(수신거부 버튼 등)에서도 그대로 쓰기 위해 pg 의존이 없는 모듈로 분리한다.

/** 연속 안내 기본 회차 수 — 문구의 기본값. 실제 발송 문구는 키 설정값(days)으로 렌더한다. */
export const AD_SEQ_ROUNDS = 4;

/**
 * 범위 안내 한 문장 — "총 N회 전체"가 대상임을 분명히 한다.
 *   'N회차'를 "N번째 회차만"으로 오해하지 않도록 '총 N회에 걸쳐'로 적는다.
 */
export function adScopeNotice(rounds = AD_SEQ_ROUNDS): string {
  return `수신거부는 신청 후 총 ${rounds}회에 걸쳐 발송되는 광고 문자·메일에만 적용됩니다.`
    + ` 계약·일정·거래 확인 등 서비스 알림은 계속 받을 수 있습니다.`;
}

/** 문자 하단 짧은 안내(링크 앞) — 글자 수를 아끼되 범위를 남긴다. */
export function adSeqSmsLabel(rounds = AD_SEQ_ROUNDS): string {
  return `${rounds}회차 광고 문자·메일 수신거부: `;
}

/** 남은 회차까지 전부 멈춘다는 설명 — "마지막 회차만 중단" 오해 방지용. */
export function adAllRoundsNotice(rounds = AD_SEQ_ROUNDS): string {
  return `총 ${rounds}회 안내 전체가 대상입니다 — 남은 회차도 발송되지 않습니다.`;
}

/**
 * 범위 정합성 한 줄 — 연속 안내(총 N회) 외에 다른 광고성 발송이 있을 수 있고,
 * 그 경우에도 같은 수신거부가 적용된다(차단 범위가 안내보다 좁아지지 않게).
 */
export const AD_SCOPE_ALSO_OTHER = "그 밖에 보내드리는 광고성 문자·메일이 있다면 함께 중단됩니다.";
