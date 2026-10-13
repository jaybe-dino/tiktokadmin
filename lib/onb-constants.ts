// 온보딩 첨부 슬롯 규격 — 순수 상수(DB 의존 없음).
//   공개 신청서("use client")와 서버가 같은 값을 쓰도록 여기 한 곳에 둔다.
//   lib/onboarding.ts 는 DB 를 가져오므로 클라이언트에서 import 할 수 없다.

/** 회사자료(브랜드 소개서 등) 다중 첨부용 필드 키 — 이 키만 여러 개를 담는다. */
export const COMPANY_DOCS_FIELD = "company_docs";
/** 회사자료 1개 최대 용량(50MB). 다른 슬롯(신분증·등기부 등)은 기존 10MB 를 유지한다. */
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
