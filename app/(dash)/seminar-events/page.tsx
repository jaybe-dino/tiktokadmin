import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import SevAdminPanel from "@/components/SevAdminPanel";

export const dynamic = "force-dynamic";
// 신청자 개인정보가 담긴 화면 — 검색엔진 수집 차단.
export const metadata = { title: "세미나 관리", robots: { index: false, follow: false } };

export default async function SeminarEventsPage() {
  await currentUser();
  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="세미나 관리"
        desc="공개 세미나 모집 목록(/events)과 행사별 신청자를 관리합니다 — 브랜드 원장·자동발송과 분리된 전용 DB입니다."
      />
      <SevAdminPanel />
    </div>
  );
}
