// 연속 안내(드립)의 순수 계산부 — 일정 계산·요일 처리·타입.
//   어드민 편집 화면(클라이언트)에서도 쓰므로 DB(pg)를 끌고 오면 안 된다.
//   DB 를 쓰는 조회·저장·발송은 lib/lead-sequence.ts 에 있다.

export const KST_OFFSET_MIN = 9 * 60;
export const MAX_SEQ_DAYS = 30;
/** 회차 이름 — 화면·로그 공통. 회차는 1일차부터다.
 *  유입 즉시 발송은 기존 1회성 자동안내(키의 「내용」)가 담당하므로 여기서 다루지 않는다. */
export function dayLabel(n: number): string {
  return `유입 ${n}일차`;
}

export interface SeqConfig {
  channel_id: string;
  enabled: boolean;
  days: number;              // 몇 일차까지
  hour: number;              // 기본 발송 시각(KST 시)
  stopOnProgress: boolean;   // 상담·미팅 등 단계가 진전되면 중단
}

export interface SeqStep {
  channel_id: string; day_no: number;   // 1 = 유입 1일차
  enabled: boolean;
  send_sms: boolean; send_email: boolean;
  send_hour: number | null;  // 이 일차만의 발송 시각(없으면 키 기본 시각)
  sms_body: string; email_subject: string; email_body: string;
}

export const clampDays = (n: unknown): number => Math.min(MAX_SEQ_DAYS, Math.max(1, Math.round(Number(n) || 5)));
export const clampHour = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(23, Math.max(0, v)) : 10;
};

export function defaultSeqConfig(channelId: string): SeqConfig {
  return { channel_id: channelId, enabled: false, days: 5, hour: 10, stopOnProgress: true };
}

// 한국시간 기준으로 "며칠 뒤 몇 시"를 구한다. 서버 TZ 와 무관하도록 UTC 로 환산해 계산한다.
/** from(유입시각) 기준 offsetDays 일 뒤 KST hour 시 → UTC Date. */
export function kstSlot(from: Date, offsetDays: number, hour: number): Date {
  const kst = new Date(from.getTime() + KST_OFFSET_MIN * 60_000);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  const slotKst = Date.UTC(y, m, d + offsetDays, clampHour(hour), 0, 0, 0);
  return new Date(slotKst - KST_OFFSET_MIN * 60_000);
}

export interface PlanInput {
  days: number;   // 몇 일차까지
  hour: number;   // 기본 발송 시각
  /** 회차별 시각(없으면 기본 시각) — 회차마다 다른 시간을 정할 수 있다. */
  hourByDay?: Record<number, number | null>;
}

/**
 * 회차별 예정 시각 — 유입 N일차 = 유입일로부터 N일 뒤, 그 회차 시각(없으면 기본 시각).
 *   유입 당일(즉시) 발송은 기존 1회성 자동안내가 이미 하므로 여기엔 없다.
 */
export function planSchedule(from: Date, s: PlanInput): { day_no: number; due_at: Date }[] {
  const hourOf = (d: number): number => {
    const h = s.hourByDay?.[d];
    return h == null ? clampHour(s.hour) : clampHour(h);
  };
  const out: { day_no: number; due_at: Date }[] = [];
  for (let d = 1; d <= clampDays(s.days); d++) {
    out.push({ day_no: d, due_at: kstSlot(from, d, hourOf(d)) });
  }
  return out;
}
