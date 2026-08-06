import { getSurveyByToken } from "@/lib/repo/card";
import { getQuestions } from "@/lib/survey-db";
import SurveyForm from "./SurveyForm";

export const dynamic = "force-dynamic";

// 공개 설문 응답 페이지 (14-A) — 로그인 불필요, 모바일 최적화.
export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const survey = await getSurveyByToken(token.trim()).catch(() => null);

  if (!survey) {
    return (
      <Shell>
        <div className="text-center text-gray-500 py-16">
          <p className="text-lg">설문을 찾을 수 없습니다.</p>
          <p className="text-sm mt-2">링크가 만료되었거나 잘못되었습니다.</p>
        </div>
      </Shell>
    );
  }

  if (survey.responded_at) {
    return (
      <Shell>
        <div className="text-center py-16">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-lg font-bold">응답이 완료되었습니다.</p>
          <p className="text-sm text-gray-500 mt-2">소중한 답변 감사합니다 — {survey.brand_name}</p>
        </div>
      </Shell>
    );
  }

  const isPre = survey.kind === "pre_meeting";
  return (
    <Shell>
      <div className="mb-6">
        <div className="text-sm text-pink-600 font-semibold">
          {isPre ? "GloveK · 1:1 미팅 사전 설문" : "GloveK · 마케팅 사전 설문"}
        </div>
        <h1 className="text-xl font-extrabold mt-1">
          {isPre ? `${survey.brand_name}님, 미팅 전에 몇 가지만 여쭤볼게요` : `${survey.brand_name}님, 몇 가지만 여쭤볼게요`}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {isPre
            ? "1:1 미팅을 알차게 준비하기 위한 설문입니다. 마케팅 방향과 회사 기본정보를 여쭤봅니다 — 2분이면 됩니다."
            : "미팅에서 논의한 내용을 바탕으로 맞춤 제안을 준비하기 위한 설문입니다. 1분이면 됩니다."}
        </p>
      </div>
      <SurveyForm token={token} questions={await getQuestions(survey.kind)} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#faf7f8" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
          {children}
        </div>
        <div style={{ textAlign: "center", color: "#bbb", fontSize: 12, marginTop: 16 }}>© GloveK</div>
      </div>
    </div>
  );
}
