import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import OptOutListPanel from "@/components/OptOutListPanel";

export const dynamic = "force-dynamic";
// 연락처가 담긴 화면 — 검색엔진 수집 차단.
export const metadata = { title: "발송제외 명단", robots: { index: false, follow: false } };

export default async function OptOutsPage() {
  await currentUser();
  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="발송제외 명단"
        desc="자동 안내·광고 발송을 차단하는 명단입니다. 고객 DB 내보내기와 외부 신청자 목록에서도 제외하며, 명단 확인에 실패하면 내보내기를 중단합니다."
      />
      <OptOutListPanel />
    </div>
  );
}
