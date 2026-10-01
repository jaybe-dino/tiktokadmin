import WeeklyApplyForm from "./WeeklyApplyForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "틱톡샵 온보딩 신청서",
  description: "틱톡샵 온보딩은 한정된 슬롯으로 진행됩니다 — 사전 신청하시면 담당자가 일정과 준비 사항을 안내드립니다.",
};

// 공개 신청서. 제출은 전용 표에만 저장되고 자동 문자·메일 캠페인으로 이어지지 않는다.
export default function WeeklyApplyPage() {
  return <WeeklyApplyForm />;
}
