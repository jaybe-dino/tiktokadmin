import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import SeminarApplyAdminPanel from "@/components/SeminarApplyAdminPanel";
import { PROGRAM_TITLE } from "@/lib/seminar-apply-model";

export const dynamic = "force-dynamic";
// 신청자 개인정보가 담긴 화면 — 검색엔진 수집 차단.
export const metadata = { title: "세미나 신청 관리", robots: { index: false, follow: false } };

export default async function SeminarApplyAdminPage() {
  await currentUser();
  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="세미나 신청 관리"
        desc={`${PROGRAM_TITLE} — 회차별 신청자를 검토해 선정합니다. 접수는 제한 없이 받고 30명 상한은 선정에만 적용합니다.`}
      />
      <SeminarApplyAdminPanel />
    </div>
  );
}
