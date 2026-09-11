import JpApplyForm from "./JpApplyForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "일본 진출 사전 신청 · TikTok Shop",
  description: "TikTok Shop 일본 진출 사전 신청 — 10월 이후 온보딩 가이드를 순차 안내드립니다.",
};

// 일본 진출 사전 신청(공개) — 제출 시 리드로 인입되고, 기존 고객과 이메일·연락처가
//   겹치면 같은 브랜드로 자동 병합된다(중복 카드 생성 없음).
export default function JpApplyPage() {
  return <JpApplyForm />;
}
