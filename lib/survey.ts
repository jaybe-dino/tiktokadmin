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
  help?: string;    // "쉽게 말하면" — 라벨 아래 보조 설명(콘텐츠 브리프)
  example?: string; // 좋은 답변 예시 — 접힘(details)으로 표시
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

// ── 브랜드 제품 브리프 설문 (콘텐츠 설문, kind='content_brief') ──────────────
// 마케팅 파트에서 브랜드(기업)별·제품별로 발급 — 여러 개 발급 가능.
// 노션 "템플릿 | 브랜드 제품 브리프 설문지" 기반: 제품을 잘 아는 담당자의 언어를
// 크리에이터가 촬영 가능한 콘텐츠 언어로 바꾸기 위한 설문. help=쉽게 말하면, example=좋은 답변 예시.
const S1 = "1. 제품과 캠페인의 기본 정보";
const S2 = "2. 제품의 가장 중요한 장점 찾기";
const S3 = "3. 크리에이터가 실제로 보여 줄 수 있는 장면";
const S4 = "4. 제품의 효과를 믿게 하는 자료";
const S5 = "5. 원하는 콘텐츠 분위기와 필수 요소";
const S6 = "6. 누구에게, 어떤 크리에이터를 통해 말할까요?";

export const CONTENT_BRIEF_QUESTIONS: SurveyQuestion[] = [
  { key: "q1_contact", label: "1. 우리 브랜드와 이 설문을 확인할 담당자는 누구인가요?", type: "text", section: S1,
    help: "나중에 제품 표현이나 자료를 확인해야 할 때 연락할 사람을 알려 주세요.",
    example: "브랜드명: Colorfrom / 작성: 브랜드마케팅팀 이성경 팀장 (brand@example.com) / 최종 검수: 제품개발팀 이지은 과장" },
  { key: "product_name_kr", label: "2. 제품 국문명", type: "short", section: S1, placeholder: "예: 고마쥬 클렌징 밤",
    help: "제품을 온라인에서 찾을 수 있도록 정확한 이름을 적어 주세요." },
  { key: "product_name_en", label: "2-1. 제품 영문명", type: "short", section: S1, optional: true, placeholder: "예: Gommage Cleansing Balm" },
  { key: "product_option", label: "2-2. 옵션·용량", type: "short", section: S1, optional: true, placeholder: "예: 80g, 단일 향" },
  { key: "product_price", label: "2-3. 권장소비자가", type: "short", section: S1, optional: true, placeholder: "예: 28,000원" },
  { key: "q3_one_liner", label: "3. 이 제품을 한 문장으로 소개해 주세요.", type: "text", section: S1,
    help: "작성 틀: [누구]를 위한 [제품 종류]로, [불편·문제]를 [제품만의 방식]으로 돕는 제품.",
    example: "워터프루프 메이크업을 자주 하는 민감 피부 소비자를 위한 클렌징 밤으로, 여러 번 문질러야 하는 세정의 불편을 밤에서 오일로 녹는 제형으로 줄여 주는 제품입니다." },
  { key: "q4_goal", label: "4. 이번 협업을 통해 가장 얻고 싶은 결과는 무엇인가요?", type: "select", section: S1,
    options: ["제품 사용법을 이해시키고 싶다", "제품이 믿을 만하다는 인상을 주고 싶다", "브랜드·제품 인지도를 높이고 싶다", "구매로 이어지게 하고 싶다", "기타"],
    help: "영상을 본 사람이 무엇을 하기를 원하는지 하나만 골라 주세요." },
  { key: "q5_market", label: "5. 어느 나라, 언어의 고객에게 보여 줄 예정인가요?", type: "text", section: S1,
    help: "어디에 사는 사람들이 어느 언어로, 어느 SNS에서 볼지 알려 주세요.",
    example: "우선 시장: 미국 / 언어: 영어 (미국 거주 영어 사용 크리에이터만 가능)" },

  { key: "q7_key_message", label: "7. 고객이 이 제품을 보고 꼭 기억했으면 하는 한 가지는 무엇인가요?", type: "text", section: S2,
    help: "“그래서 이 제품이 왜 필요한데?”라는 질문에 가장 먼저 답하는 문장입니다.",
    example: "진한 워터프루프 메이크업도 빠르게 지우면서, 눈가를 과하게 문지르지 않아도 되는 클렌징 밤입니다." },
  { key: "q8_benefits", label: "8. 이 제품의 장점을 최대 5개까지, 중요도 순서대로 적어 주세요.", type: "text", section: S2,
    help: "작성 틀: 장점 → 고객에게 좋은 점 → 이를 증명할 수 있는 자료 또는 사실.",
    example: "밤→오일 제형 변화 → 질감 변화가 보여 재미있음 → 실사용 영상 촬영 가능\n워터프루프 세정 → 여러 번 문지를 필요 적음 → 사용 시연 가능" },
  { key: "q9_difference", label: "9. 고객이 지금 쓰는 다른 방법보다 이 제품이 편하거나 다른 점은 무엇인가요?", type: "text", section: S2, optional: true,
    help: "경쟁 브랜드 이름 없이, 고객이 원래 하던 방법과의 차이를 알려 주세요. 근거 없는 비교 표현은 쓰지 않습니다." },
  { key: "q10_situations", label: "10. 고객은 어떤 상황에서 이 제품을 가장 필요로 하나요?", type: "text", section: S2,
    help: "실제 생활 장면을 떠올려 적어 주세요 — 영상 첫 장면을 만드는 데 쓰입니다.",
    example: "진한 아이라이너를 지운 뒤에도 눈가가 남아 여러 번 닦는 날 / 여행 중 클렌징 제품 여러 개 챙기기 번거로운 날" },
  { key: "q11_pain", label: "11. 이 제품이 없으면 고객이 어떤 불편을 겪나요?", type: "text", section: S2, optional: true,
    help: "과장된 공포 대신 일상 속 불편을 적어 주세요." },

  { key: "q12_usage_steps", label: "12. 제품을 처음 열고 사용을 끝낼 때까지, 실제 사용 순서를 적어 주세요.", type: "text", section: S3,
    help: "설명서의 사용법 그대로도 좋습니다. 양·시간·물 사용 여부가 중요합니다.",
    example: "① 마른 손에 콩알 2개 분량 ② 20~30초 마사지 ③ 물을 묻혀 유화 ④ 미온수로 헹굼 (눈에 들어가지 않게 주의)" },
  { key: "q13_sensory", label: "13. 제품을 쓰는 동안 눈·귀·손으로 느낄 수 있는 변화는 무엇인가요?", type: "text", section: S3, optional: true,
    help: "영상으로 보여 주기 좋은 변화 — 제형·색·소리·향·거품·녹는 과정 등." },
  { key: "q14_demo_safety", label: "14. 영상에서 직접 보여 줄 수 있는 장면과, 그때 지켜야 할 안전 수칙을 적어 주세요.", type: "text", section: S3, optional: true,
    help: "가능한 시연 장면과 하지 말아야 할 행동을 같이 알려 주세요." },
  { key: "q15_expected_change", label: "15. 제품을 쓰고 나서 언제 어떤 변화를 기대할 수 있나요?", type: "text", section: S3, optional: true,
    help: "바로 느낄 수 있는 것과 며칠 뒤 기대할 수 있는 것을 나눠서. 확실하지 않으면 '확인 필요'라고 적어 주세요." },
  { key: "q16_hook", label: "16. 영상 첫 3초에 보여 주면 사람들이 놀라거나 궁금해할 장면은 무엇인가요?", type: "text", section: S3,
    help: "“이게 진짜 되나?” 하고 계속 보게 만드는 변화나 장면입니다.",
    example: "잘 지워지지 않는 아이라이너를 손등에 바른 뒤 한 번 문질러 녹아 나가는 모습 / 단단한 밤이 오일로 변하는 클로즈업" },
  { key: "q17_banned_scenes", label: "17. 영상에서 절대 하면 안 되는 사용법이나 장면이 있나요?", type: "text", section: S3, optional: true,
    help: "안전·위생·제품 오해 방지를 위해 금지해야 하는 행동을 적어 주세요." },

  { key: "q18_allowed_claims", label: "18. 크리에이터가 말해도 되는 제품 효과 또는 기능은 무엇인가요?", type: "text", section: S4, optional: true,
    help: "제품 소개에서 써도 되는 문장을 그대로. 전문 용어는 쉬운 말도 함께 적어 주세요. 근거 자료가 있을 때만 수치를 적습니다." },
  { key: "q19_clinical", label: "19. 임상 또는 시험 결과가 있다면, 숫자와 조건을 함께 적어 주세요.", type: "text", section: S4, optional: true,
    help: "작성 틀: 무엇을 측정 / 결과 / 기간 / 인원 / 시험 기관 / 사용 가능한 정확한 문장.",
    example: "블랙헤드 개선 / 2주 후 평균 29.38% 감소 / 성인 20명 / A 피부임상연구소 / 자료 원본 첨부" },
  { key: "q20_evidence", label: "20. 이 제품의 효과나 특징을 증명하는 자료 링크를 적어 주세요.", type: "text", section: S4, optional: true,
    help: "시험 보고서·인증서·전후 사진·상세페이지·실제 후기 링크. 없다면 '해당 없음'." },
  { key: "q21_ingredients", label: "21. 강조하고 싶은 성분·원료·인증·브랜드 가치가 있나요?", type: "text", section: S4, optional: true,
    help: "성분 이름만 쓰지 말고, 왜 들어갔고 고객에게 어떤 점이 좋은지 적어 주세요." },
  { key: "q22_reviews", label: "22. 인용할 수 있는 실제 고객 후기나 사용 경험이 있나요?", type: "text", section: S4, optional: true,
    help: "실제로 인용 가능한 문장과 출처(URL)를 알려 주세요." },

  { key: "q23_content_types", label: "23. 어떤 종류의 영상을 우선 만들고 싶나요? (최대 3개)", type: "multi", section: S5,
    options: ["문제 해결형", "전후 대비형", "제형·ASMR형", "성분·과학 설명형", "며칠 사용 후기형", "루틴형", "유머·반전형"],
    help: "문제 해결형: “이런 불편, 저도 겪어요”로 시작 · 전후 대비형: 사용 전후 차이 · 제형·ASMR형: 소리·질감 · 성분·과학형: 근거 설명 · 후기형: Day1→Day7 기록 · 루틴형: 일상 루틴에 배치 · 유머·반전형: 예상과 다른 결과" },
  { key: "q24_tone", label: "24. 브랜드가 좋아하는 말투·분위기와 피하고 싶은 분위기를 알려 주세요.", type: "text", section: S5, optional: true,
    example: "선호: 친구가 직접 써 본 듯 솔직하지만 정보는 정확하게 / 비선호: 공포감 주는 클로즈업, 전문의처럼 단정하는 말투, 과보정 전후 이미지" },
  { key: "q25_must_include", label: "25. 영상에 꼭 들어가야 하는 내용은 무엇인가요?", type: "text", section: S5, optional: true,
    help: "필수 장면·제품명·문구·계정 태그·고지를 구분해 적어 주세요. 모르면 비워 두셔도 됩니다." },
  { key: "q25_hashtags", label: "25-1. 모든 콘텐츠에 반드시 넣을 해시태그 5개를 정해 주세요.", type: "text", section: S5, optional: true,
    help: "① 브랜드 공식 태그 ② 제품명 태그 ③ 카테고리 태그 ④ 핵심 효익·고민 태그 ⑤ 브랜드·시장 맥락 태그(K-Beauty 등). #ad 같은 광고 표기는 별도.",
    example: "#Returnu #ReturnuCleansingBalm #CleansingBalm #WaterproofMakeupRemover #KBeauty" },
  { key: "q26_cta", label: "26. 필수 CTA가 있다면 적어 주세요.", type: "text", section: S5, optional: true,
    help: "영상 마지막에 시청자에게 요청하는 행동 — 작성 틀: 누가 / 어디에서 / 무엇을 하도록 / 언제까지." },
  { key: "q27_banned_words", label: "27. 절대 쓰면 안 되거나, 먼저 확인받아야 하는 말·장면이 있나요?", type: "text", section: S5, optional: true,
    help: "“금지”와 “사전 승인 필요”를 구분해 주세요.",
    example: "금지: “여드름을 치료한다”, “100% 무자극” / 사전 승인: 임상 수치 그래픽, 가격·할인율 표현, 미성년자 출연" },
  { key: "q28_legal", label: "28. 광고 표기나 법적·플랫폼 규칙 중 꼭 지켜야 할 것이 있나요?", type: "text", section: S5, optional: true,
    help: "유료 협찬 표기(Paid Partnership·#ad), 국가별 금지 표현, 사전 심의 여부 등." },
  { key: "q29_reference_videos", label: "29. 참고하고 싶은 영상이 있다면 최대 3개를 공유해 주세요.", type: "text", section: S5, optional: true,
    help: "링크와 함께, 어떤 부분이 마음에 드는지 한 줄로 적어 주세요." },

  { key: "q30_target", label: "30. 가장 먼저 공략할 고객은 누구인가요?", type: "text", section: S6,
    help: "성별·나이만 쓰지 말고 평소 생활과 구매 이유를. 1순위·2순위 모두 적어 주세요.",
    example: "1순위: 20대 후반~30대 초반 미국 거주, 진한 아이메이크업을 자주 하고 세안 후 잔여감이 싫은 사람" },
  { key: "q31_creator_type", label: "31. 어떤 유형의 크리에이터가 이 제품을 가장 자연스럽게 보여 줄 수 있나요?", type: "text", section: S6, optional: true,
    help: "팔로워 수보다 “이 사람이 왜 이 제품을 쓰면 자연스러운가”를 적어 주세요." },
  { key: "q32_creator_condition", label: "32. 선호하는 크리에이터의 조건을 알려 주세요.", type: "text", section: S6, optional: true,
    help: "분야·팔로워 규모·언어·지역·말투·화면 분위기. 기준이 없으면 '추천 필요'라고 적어 주세요." },
  { key: "q33_creator_exclude", label: "33. 피해야 할 크리에이터 유형 또는 브랜드 안전 기준이 있나요?", type: "text", section: S6, optional: true },
  { key: "q34_collab_terms", label: "34. 협업 운영 조건을 알려 주세요.", type: "text", section: S6, optional: true,
    help: "크리에이터에게 제공하는 것 — 제공 제품·수량·커미션 비율 등.",
    example: "제품 제공: 홍삼액 선물세트 30포 1개 + 쇼핑백 / 커미션: 20%" },
];

/** surveys.kind → 문항 세트. 알 수 없는 kind 는 기존(미팅 후) 문항 유지. */
export function questionsForKind(kind: string): SurveyQuestion[] {
  if (kind === "pre_meeting") return PRE_MEETING_QUESTIONS;
  if (kind === "content_brief") return CONTENT_BRIEF_QUESTIONS;
  return POST_MEETING_QUESTIONS;
}

/** surveys.kind → 화면 라벨. */
export function surveyKindLabel(kind: string | null | undefined): string {
  if (kind === "pre_meeting") return "사전 설문";
  if (kind === "content_brief") return "콘텐츠 브리프 설문";
  return "미팅 후 설문";
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
