import WeeklyApplyForm from "./WeeklyApplyForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "틱톡샵 주간 온보딩 신청",
  description: "매주 3개 브랜드 모집 — 세미나 전 온보딩 상담·준비를 미리 신청하세요.",
};

// 공개 신청서. 제출은 전용 표에만 저장되고 자동 문자·메일 캠페인으로 이어지지 않는다.
export default function WeeklyApplyPage() {
  return <WeeklyApplyForm />;
}
