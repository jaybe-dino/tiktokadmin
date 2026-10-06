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
        desc="세미나 1~4회차 안내·광고·유입 즉시 안내가 보내기 직전에 보는 수신거부 명단입니다 — 이 화면은 발송하지 않습니다."
      />
      <OptOutListPanel />
    </div>
  );
}
