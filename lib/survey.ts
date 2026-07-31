// 미팅 후 마케팅 설문 문항 정의 (14-A). settings 편집 대비 상수 분리.
export interface SurveyQuestion {
  key: string;
  label: string;
  type: "select" | "multi" | "text" | "consent";
  options?: string[];
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
  { key: "concerns", label: "우려사항·질문", type: "text" },
  { key: "marketing_consent", label: "정기 마케팅 정보 수신 동의", type: "consent" },
];

/** 목표국 라벨(한글) → 국가코드. brands.countries 는 한글 라벨 사용(COUNTRY_OPTIONS). */
export const COUNTRY_LABEL_TO_CODE: Record<string, string> = {
  미국: "US", 베트남: "VN", 태국: "TH", 싱가포르: "SG", 필리핀: "PH", 말레이시아: "MY",
};
