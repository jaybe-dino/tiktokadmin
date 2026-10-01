import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import WeeklyOnbPanel from "@/components/WeeklyOnbPanel";

export const dynamic = "force-dynamic";
// 신청자 개인정보가 담긴 화면 — 검색엔진 수집 차단.
export const metadata = { title: "온보딩 사전신청", robots: { index: false, follow: false } };

export default async function WeeklyOnbPage() {
  await currentUser();
  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="온보딩 사전신청"
        desc="틱톡샵 온보딩 신청서로 들어온 접수 목록입니다 — 담당자가 확인 후 일정과 준비 사항을 안내합니다."
      />
      <WeeklyOnbPanel />
    </div>
  );
}
