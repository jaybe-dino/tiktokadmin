// 미팅 후 마케팅 설문 문항 정의 (14-A). settings 편집 대비 상수 분리.
// ⚠️ 이 파일은 클라이언트에서도 import 됨 — DB/서버 의존성을 넣지 말 것(순수 상수만).
export interface SurveyQuestion {
  key: string;
  label: string;
  type: "select" | "multi" | "text" | "short" | "consent"; // short: 한 줄 입력(회사정보)
  options?: string[];
  placeholder?: string;
  section?: string; // 주제 구획(DB 문항 뱅크에서 채워짐)
  optional?: boolean; // 미지정 시 필수. 자유서술·수신동의만 선택.
}

export const POST_MEETING_QUESTIONS: SurveyQuestion[] = [
  { key: "budget_band", label: "월 마케팅 예산대", type: "select",
    options: ["~300만원", "300~500만원", "500~1000만원", "1000만원 이상", "미정"] },
  { key: "seeding_capacity", label: "월 시딩 가능 수량(무상 제공)", type: "select",
    options: ["~10개", "10~30개", "30~50개", "50개 이상", "미정"] },
  { key: "target_countries", label: "목표 국가(복수 선택)", type: "multi",
    options: ["미국", "베트남", "태국", "싱가포르", "필리핀", "말레이시아"] },
  { key: "timeline", label: "희망 시작 시기", type: "select",
    options: ["즉시", "1개월 내", "3개월 내", "미정"] },
  { key: "concerns", label: "우려사항·질문", type: "text", optional: true },
  { key: "marketing_consent", label: "정기 마케팅 정보 수신 동의", type: "consent", optional: true },
];

// ── 1:1 미팅 사전 설문 (기획확정 8절) ──────────────────────────
// 마케팅 내용 + 회사정보(사업자등록번호·회사명·주소·담당자 연락처).
// 스키마 변경 없음 — surveys.answers jsonb 에 아래 key 로 저장(kind='pre_meeting').
export const PRE_MEETING_QUESTIONS: SurveyQuestion[] = [
  // 마케팅
  { key: "marketing_goal", label: "마케팅 목표", type: "select",
    options: ["브랜드 인지도 확대", "해외 매출 창출", "신제품 런칭", "인플루언서·바이럴 확산", "기타"] },
  { key: "existing_channels", label: "기존 판매·마케팅 채널(복수 선택)", type: "multi",
    options: ["자사몰", "스마트스토어", "쿠팡", "올리브영", "인스타그램", "틱톡", "유튜브", "오프라인", "없음"] },
  { key: "monthly_ad_budget", label: "월 광고 예산", type: "select",
    options: ["없음", "~100만원", "100~300만원", "300~500만원", "500~1000만원", "1000만원 이상"] },
  { key: "has_content", label: "콘텐츠 보유 현황(상세페이지·영상 등)", type: "select",
    options: ["충분히 보유", "일부 보유", "없음(제작 필요)"] },
  // 회사정보
  { key: "biz_reg_no", label: "사업자등록번호", type: "short", placeholder: "000-00-00000" },
  { key: "company_name", label: "회사명(상호)", type: "short", placeholder: "사업자등록증상 상호" },
  { key: "company_address", label: "회사 주소", type: "short", placeholder: "사업자등록증상 주소" },
  { key: "contact_phone", label: "담당자 연락처", type: "short", placeholder: "010-0000-0000" },
];

/** surveys.kind → 문항 세트. 알 수 없는 kind 는 기존(미팅 후) 문항 유지. */
export function questionsForKind(kind: string): SurveyQuestion[] {
  return kind === "pre_meeting" ? PRE_MEETING_QUESTIONS : POST_MEETING_QUESTIONS;
}

/** surveys.kind → 화면 라벨. */
export function surveyKindLabel(kind: string | null | undefined): string {
  return kind === "pre_meeting" ? "사전 설문" : "미팅 후 설문";
}

/** 한 문항이 응답되었는지 판정. multi 는 1개 이상, consent 는 항상 응답으로 간주, 그 외는 비어있지 않은 문자열. */
export function isAnswered(q: SurveyQuestion, v: unknown): boolean {
  if (q.type === "multi") return Array.isArray(v) && v.length > 0;
  if (q.type === "consent") return true; // 체크 여부 자체가 응답 — 선택 항목
  return typeof v === "string" && v.trim().length > 0;
}

/** 필수(optional 아님) 문항 중 미응답 목록 반환. 클라이언트·서버 공통 검증. */
export function missingRequired(
  questions: SurveyQuestion[],
  answers: Record<string, unknown>,
): SurveyQuestion[] {
  return questions.filter((q) => !q.optional && !isAnswered(q, answers[q.key]));
}

/** 목표국 라벨(한글) → 국가코드. brands.countries 는 한글 라벨 사용(COUNTRY_OPTIONS). */
export const COUNTRY_LABEL_TO_CODE: Record<string, string> = {
  미국: "US", 베트남: "VN", 태국: "TH", 싱가포르: "SG", 필리핀: "PH", 말레이시아: "MY",
};
