import ScreenHeader from "@/components/ScreenHeader";
import { listQuestions } from "@/lib/survey-db";
import SurveyQuestionsEditor from "./SurveyQuestionsEditor";

export const dynamic = "force-dynamic";

// 설문 문항 관리 — pre_meeting(1:1 미팅 사전) / post_meeting(미팅 후) 문항 뱅크 편집.
export default async function SurveySettingsPage() {
  const [pre, post] = await Promise.all([listQuestions("pre_meeting"), listQuestions("post_meeting")]);
  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="설문 문항 관리"
        desc="브랜드에게 보내는 설문 문항을 추가·수정·정렬·비활성할 수 있습니다. 저장 즉시 발송 링크에 반영됩니다."
      />
      <SurveyQuestionsEditor kind="pre_meeting" kindLabel="1:1 미팅 사전 설문" initial={pre} />
      <div style={{ height: 22 }} />
      <SurveyQuestionsEditor kind="post_meeting" kindLabel="미팅 후 설문" initial={post} />
    </div>
  );
}
