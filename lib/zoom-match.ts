// Zoom 회의 → 브랜드 매핑 규칙(순수 로직 — DB 조회 결과를 받아 판정만 한다).
//   원칙:
//     1) 시스템에서 예약하며 남긴 명시적 연결(brand_id + 줌 링크의 회의 ID + 예정 시각)이 최우선.
//     2) 반복 회의는 숫자 회의 ID 가 매 회차 같으므로, ID 만으로 합치지 않는다 —
//        반드시 "예정 시각이 이 회차와 가까운" 예약이어야 한다.
//     3) 참석자 이메일은 보조 근거. 제목·AI 추측만으로는 확정하지 않는다.
//     4) 후보가 여러 개면 확정하지 않고 미매핑 검토함으로 보낸다.

/** 줌 참가 링크에서 숫자 회의 ID 추출 — https://…/j/81234567890?pwd=… → "81234567890" */
export function zoomIdFromUrl(url: string | null | undefined): string | null {
  const m = (url ?? "").match(/\/j\/(\d{9,12})/);
  return m ? m[1] : null;
}

export interface BookingRow {
  id: string;                    // meetings.id (예약으로 만들어진 행)
  brand_id: string | null;
  topic: string | null;
  scheduled_at: string | null;
  zoom_join_url: string | null;
  zoom_meeting_id: string | null;
}

export interface MatchInput {
  zoomMeetingId: string | null;       // 이번 회차의 숫자 회의 ID
  startedAt: string | null;           // 이번 회차 시작 시각(ISO)
  bookings: BookingRow[];             // 같은 숫자 ID 후보 예약들(브랜드 지정된 것만)
  emailBrandIds: string[];            // 참석자 이메일로 찾은 브랜드 id(중복 제거 전)
}

export interface MatchResult {
  brandId: string | null;
  method: "booking" | "email" | "none";
  reason: string;
  bookingMeetingId?: string;          // 이어붙일 예약 행
  candidates: { brand_id: string; why: string }[];
}

/** 예약 시각과 실제 시작 시각의 허용 오차(시간) — 이 안이면 같은 회차로 본다. */
export const BOOKING_WINDOW_HOURS = 12;

function hoursApart(a: string, b: string): number {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(ta - tb) / 3_600_000;
}

export function matchBrand(input: MatchInput): MatchResult {
  const { zoomMeetingId, startedAt, bookings, emailBrandIds } = input;

  // ── 1) 명시적 예약 연결 ──
  if (zoomMeetingId && startedAt) {
    const sameId = bookings.filter(
      (b) => b.brand_id && (b.zoom_meeting_id === zoomMeetingId || zoomIdFromUrl(b.zoom_join_url) === zoomMeetingId),
    );
    // 반복 회의 방어: 시각이 이 회차와 가까운 예약만 남긴다.
    const near = sameId
      .map((b) => ({ b, gap: b.scheduled_at ? hoursApart(b.scheduled_at, startedAt) : Number.POSITIVE_INFINITY }))
      .filter((x) => x.gap <= BOOKING_WINDOW_HOURS)
      .sort((x, y) => x.gap - y.gap);

    const brands = new Set(near.map((x) => x.b.brand_id!));
    if (brands.size === 1) {
      const hit = near[0];
      return {
        brandId: hit.b.brand_id,
        method: "booking",
        reason: `예약 연결 — 줌 회의 ID ${zoomMeetingId}, 예정 ${hit.b.scheduled_at?.slice(0, 16) ?? "?"} (실제 시작과 ${hit.gap.toFixed(1)}시간 차)`,
        bookingMeetingId: hit.b.id,
        candidates: [],
      };
    }
    if (brands.size > 1) {
      // 같은 회의 ID 에 서로 다른 브랜드 예약 — 사람이 골라야 한다.
      return {
        brandId: null, method: "none",
        reason: `예약 후보가 ${brands.size}개 브랜드로 갈림 — 확인 필요`,
        candidates: near.map((x) => ({ brand_id: x.b.brand_id!, why: `예약 ${x.b.scheduled_at?.slice(0, 16) ?? "?"} · ${x.b.topic ?? ""}`.trim() })),
      };
    }
    if (sameId.length > 0 && near.length === 0) {
      // 반복 회의인데 이번 회차와 맞는 예약이 없음 — ID 만으로 합치지 않는다.
      return {
        brandId: null, method: "none",
        reason: `같은 회의 ID 예약은 있으나 이번 회차 시각(${startedAt.slice(0, 16)})과 ${BOOKING_WINDOW_HOURS}시간 이내 예약이 없음 — 반복 회의로 보고 자동 연결하지 않음`,
        candidates: sameId.filter((b) => b.brand_id).map((b) => ({ brand_id: b.brand_id!, why: `예약 ${b.scheduled_at?.slice(0, 16) ?? "?"} · ${b.topic ?? ""}`.trim() })),
      };
    }
  }

  // ── 2) 참석자 이메일(보조 근거) ──
  const uniq = [...new Set(emailBrandIds.filter(Boolean))];
  if (uniq.length === 1) {
    return { brandId: uniq[0], method: "email", reason: "참석자 이메일이 이 브랜드와 일치", candidates: [] };
  }
  if (uniq.length > 1) {
    return {
      brandId: null, method: "none",
      reason: `참석자 이메일이 ${uniq.length}개 브랜드와 일치 — 확인 필요`,
      candidates: uniq.map((id) => ({ brand_id: id, why: "참석자 이메일 일치" })),
    };
  }

  return { brandId: null, method: "none", reason: "예약 연결·참석자 이메일 모두 일치 없음", candidates: [] };
}
