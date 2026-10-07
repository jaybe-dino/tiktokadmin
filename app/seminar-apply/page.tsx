import SeminarApplyForm from "./SeminarApplyForm";
import { PROGRAM_TITLE, PROGRAM_TAGLINE } from "@/lib/seminar-apply-model";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `${PROGRAM_TITLE} 신청`,
  description: `${PROGRAM_TAGLINE} — 같은 내용의 세미나를 4회 운영합니다. 참석하실 회차 1개를 선택해 신청해 주세요.`,
};

// 공개 신청 화면. 로그인 없이 열리고, Zoom 접속 링크는 이 화면에 담지 않는다
//   (선정된 분께만 별도로 안내한다).
export default function SeminarApplyPage() {
  return <SeminarApplyForm />;
}
