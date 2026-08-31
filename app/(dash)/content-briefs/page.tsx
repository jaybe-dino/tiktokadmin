import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import ContentBriefsScreen from "./ContentBriefsScreen";

export const dynamic = "force-dynamic";

// 콘텐츠 브리프 설문 — 브랜드(제품별)로 발급하고 회수 현황을 한 화면에서 관리한다.
//   프로젝트 없이도 발급 가능(마케팅 프로젝트 상세·브랜드 360 안에서도 같은 카드를 쓴다).
export default async function ContentBriefsPage() {
  await currentUser();
  const brands = await query<{ id: string; brand_name: string }>(
    "SELECT id, brand_name FROM brands WHERE state NOT IN ('dropped','churned') ORDER BY brand_name",
  ).catch(() => []);

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="콘텐츠 브리프 설문"
        desc="브랜드·제품별로 콘텐츠 설문 링크를 발급하고 응답을 회수합니다 — 회수한 내용은 루틴 회차 진행·마케팅 제안서 작성 시 참조할 수 있습니다."
      />
      <ContentBriefsScreen brands={brands} />
    </div>
  );
}
