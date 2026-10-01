import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import KakaoRoomsPanel from "@/components/KakaoRoomsPanel";

export const dynamic = "force-dynamic";

export default async function KakaoPage() {
  await currentUser();
  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="카카오 수집"
        desc="PC 수집기가 보내온 카카오톡 방을 브랜드에 연결합니다 — 연결 전에는 대화가 저장되지 않습니다."
      />
      <KakaoRoomsPanel />
    </div>
  );
}
