import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import SeminarPanel from "@/components/SeminarPanel";

export const dynamic = "force-dynamic";

export default async function SeminarPage() {
  await currentUser();
  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="세미나 안내 발송"
        desc="매주 월요일 온라인 세미나 — 그 주에 새로 들어온 세미나 신청에게만 참가 안내와 2차 안내를 보냅니다."
      />
      <SeminarPanel />
    </div>
  );
}
