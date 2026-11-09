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

// ── 국가별 상세페이지 언어(BUG-51) ─────────────────────────────
//   "상세페이지(영문)" 한 가지로 묶으면 베트남·태국·일본 담당자가 영문본을 올려야
//   하는지 현지어본을 올려야 하는지 알 수 없다. 국가별로 쓸 언어를 못 박는다.
export const COUNTRY_LANG: Record<string, string> = {
  US: "영어", JP: "일본어", TH: "태국어", VN: "베트남어",
  MY: "말레이어", SG: "영어", PH: "영어",
};
/** 그 국가의 현지어 상세페이지 칸 이름. 모르는 국가는 "현지어" 로 둔다. */
export function detailPageLabel(code: string): string {
  const lang = COUNTRY_LANG[String(code || "").toUpperCase()];
  return lang ? `상세페이지(${lang})` : "상세페이지(현지어)";
}

// ── 국가별 물류 제한(BUG-55) ──────────────────────────────────
//   일본 틱톡샵은 FBA(아마존 물류)로 출고할 수 없다. 고를 수 있게 두면
//   계약 단계에서 되돌려야 하므로 목록에서 아예 빼고 이유를 적는다.
export const FBA_BLOCKED_COUNTRIES: readonly string[] = ["JP"];
export function fbaAllowed(code: string): boolean {
  return FBA_BLOCKED_COUNTRIES.indexOf(String(code || "").toUpperCase()) < 0;
}
export const FBA_BLOCKED_NOTE =
  "일본은 FBA(아마존 물류)를 선택할 수 없습니다. 현지 물류창고 계약으로 진행해 주세요.";

// ── 대표자 거주지 증명서류 안내(BUG-53) ───────────────────────
//   주소가 가려진 서류가 반복해서 올라와 심사가 되돌아가므로, 발급 단계에서
//   무엇을 확인해야 하는지 업로드 칸 바로 위에 적는다.
export const ADDRESS_PROOF_NOTICE =
  "거주지 증명서 제출 시, 주소 정보가 마스킹되지 않도록 동·호수까지 전체 주소가 "
  + "모두 확인될 수 있게 발급 및 제출 부탁드립니다.";

// ── 대표자 여권 사진면 안내(BUG-57) ───────────────────────────
export const PASSPORT_GUIDE: readonly string[] = [
  "사진·인적사항이 있는 면(여권 앞쪽)을 펼쳐서 촬영",
  "네 모서리가 모두 보이고 잘리지 않게",
  "빛 반사·그림자로 글자가 가려지지 않게",
  "이름·여권번호·생년월일·만료일이 선명하게 읽히게",
];

// ── 미국 FBT(Fulfilled by TikTok) 안내 ───────────────────────
//   "FBT 로 하면 창고 계약이 필요 없다" 는 오해가 반복되므로, 희망 체크 바로 위에
//   순서를 적어 둔다 — 창고 계약이 먼저고 FBT 신청은 샵 개설 뒤다.
export const FBT_NOTE_COUNTRIES: readonly string[] = ["US"];
export function fbtNoteFor(code: string): boolean {
  return FBT_NOTE_COUNTRIES.indexOf(String(code || "").toUpperCase()) >= 0;
}
export const FBT_US_NOTE: readonly string[] = [
  "FBT는 미국 내 지정 창고에 재고를 미리 입고하면, 틱톡이 상품 보관부터 피킹·포장·고객 배송까지 처리하는 서비스입니다.",
  "다만, 미국 틱톡샵 입점 시에는 미국 물류창고 계약서가 필수로 요구되므로, 먼저 현지 물류창고와 계약을 진행해야 합니다. 이후 샵 개설이 완료되면 FBT를 신청하여 이용하실 수 있습니다.",
];

// ── FBT 를 쓸 수 없는 국가 ────────────────────────────────────
//   일본은 FBT(Fulfilled by TikTok) 대상이 아니다. 희망 체크를 띄워 두면
//   "신청해 두면 되는 것" 으로 읽혀 나중에 되돌아가므로 아예 보여주지 않는다.
export const FBT_BLOCKED_COUNTRIES: readonly string[] = ["JP"];
export function fbtAvailable(code: string): boolean {
  return FBT_BLOCKED_COUNTRIES.indexOf(String(code || "").toUpperCase()) < 0;
}
export const FBT_BLOCKED_NOTE =
  "일본은 FBT(Fulfilled by TikTok) 대상이 아닙니다. 현지 물류창고 계약으로 진행해 주세요.";
