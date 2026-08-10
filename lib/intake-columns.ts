// 채널 세팅 시 선택 가능한 수신 DB 칼럼 — 클라이언트/서버 공용(DB 의존 없음).
//   key(brands 칼럼) ↔ param(leadhook 쿼리 파라미터명). leadhook 이 이 param 들을 인식·매핑.
export const CAPTURE_COLUMNS: { key: string; label: string; param: string }[] = [
  { key: "brand_name", label: "브랜드/회사명", param: "company" },
  { key: "contact_name", label: "담당자명", param: "name" },
  { key: "email", label: "이메일", param: "email" },
  { key: "phone", label: "전화번호", param: "phone" },
  { key: "brand_url", label: "웹사이트", param: "website" },
  { key: "category", label: "카테고리", param: "category" },
  { key: "referral_code", label: "추천코드", param: "referral_code" },
  { key: "memo", label: "메모", param: "memo" },
];
