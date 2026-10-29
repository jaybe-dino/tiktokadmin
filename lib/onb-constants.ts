// 온보딩 첨부 슬롯 규격 — 순수 상수(DB 의존 없음).
//   공개 신청서("use client")와 서버가 같은 값을 쓰도록 여기 한 곳에 둔다.
//   lib/onboarding.ts 는 DB 를 가져오므로 클라이언트에서 import 할 수 없다.

// ── 실제로 올라갈 수 있는 크기 ──────────────────────────────
//   /api/apply/upload 는 Route Handler 다. Vercel 서버리스 함수의 요청 본문은
//   4.5MB 에서 플랫폼이 끊고, 그 응답은 우리 JSON 이 아니다 — 라우트 코드가
//   아예 실행되지 않으므로 "10MB 이하만 가능합니다" 같은 안내도 띄울 수 없다.
//   (next.config 의 serverActions.bodySizeLimit 은 Server Action 전용이라
//    이 라우트에는 적용되지 않는다.)
//
//   그래서 멀티파트 오버헤드 여유를 두고 4MB 를 실제 상한으로 쓴다.
//   슬롯별 정책값(아래 50MB·5MB)은 그대로 두되, 화면·검사는 전부
//   uploadLimitBytes() 를 거쳐 이 한도 안으로 들어온다.
export const ROUTE_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

/** 슬롯 정책값과 플랫폼 한도 중 작은 쪽 — 이 값이 실제로 통과하는 크기다. */
export function uploadLimitBytes(slotLimit: number): number {
  return Math.min(slotLimit, ROUTE_BODY_LIMIT_BYTES);
}

/** 화면에 적는 용량 표기. 소수점 한 자리까지(4MB, 4.5MB). */
export function mbLabel(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}

/** 회사자료(브랜드 소개서 등) 다중 첨부용 필드 키 — 이 키만 여러 개를 담는다. */
export const COMPANY_DOCS_FIELD = "company_docs";
/** 회사자료 1개 정책 상한. 실제 통과 크기는 uploadLimitBytes() 를 거친 값이다. */
export const COMPANY_DOCS_MAX_BYTES = 50 * 1024 * 1024;
export const COMPANY_DOCS_MAX_COUNT = 20;

// ── 일본어 라벨 사진(BUG-50) ────────────────────────────────
//   일본 입점 심사에 쓰는 "제품·포장에 일본어로 표시된 라벨" 사진 슬롯.
//   회사자료와 같은 다중 첨부 구조를 쓰되 규격만 따로 둔다.
export const JP_LABEL_FIELD = "jp_label_photos";
export const JP_LABEL_MAX_BYTES = 5 * 1024 * 1024;   // 파일당 5MB
export const JP_LABEL_MAX_COUNT = 10;                // 1~10개
export const JP_LABEL_MIN_PX = 600;                  // 최소 600 × 600px
/** 사진에 반드시 보여야 하는 표시 항목 — 화면 안내문과 검수 기준을 한곳에서 관리한다. */
export const JP_LABEL_ITEMS = [
  "제품 앞·뒤·측면 및 포장 사진",
  "제품명",
  "제품 설명",
  "내용량",
  "전체 원재료 및 성분 표시",
  "제조사/판매사 명칭 및 주소",
] as const;
export const JP_LABEL_FORMATS = "PDF · PNG · JPG · JPEG";
