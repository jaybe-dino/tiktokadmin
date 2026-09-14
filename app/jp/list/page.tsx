import { cookies } from "next/headers";
import { JP_VIEW_COOKIE, verifyJpViewToken, listJpApplications } from "@/lib/jp-apply";
import JpCodeGate from "./JpCodeGate";
import JpTable from "./JpTable";

export const dynamic = "force-dynamic";
// 신청자 개인정보가 담긴 화면 — 검색엔진 수집 차단.
export const metadata = { title: "일본 사전 신청 현황", robots: { index: false, follow: false } };

// 일본 사전 신청 목록 — 코드 입력 후에만 열람(관리자 로그인과 별개의 간이 열람용).
export default async function JpListPage() {
  const unlocked = verifyJpViewToken((await cookies()).get(JP_VIEW_COOKIE)?.value);
  if (!unlocked) return <JpCodeGate />;
  const rows = await listJpApplications();
  return <JpTable rows={rows} />;
}
