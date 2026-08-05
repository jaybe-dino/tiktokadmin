import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { listTemplates } from "@/lib/proposal-doc";
import TemplateEditor from "./TemplateEditor";

export const dynamic = "force-dynamic";

// 제안서 템플릿/디자인 — 전역 기본값(대행사 로고·강조색·기본 제목·섹션 순서).
export default async function TemplatesPage() {
  await currentUser();
  const templates = await listTemplates();

  return (
    <div className="max-w-3xl">
      <ScreenHeader
        title="제안서 템플릿 · 디자인"
        desc="전역 기본 디자인(대행사 로고·강조색·기본 제목·섹션 순서). 브랜드별 로고·강조색은 각 제안서에서 오버라이드."
        right={<Link className="btn sm" href="/proposal-docs">← 제안서 목록</Link>}
      />
      <div style={{ display: "grid", gap: 14 }}>
        {templates.length === 0 && <div className="card" style={{ padding: 16, color: "var(--ink2)" }}>템플릿이 없습니다.</div>}
        {templates.map((t) => <TemplateEditor key={t.id} tpl={t} />)}
      </div>
      <div className="card" style={{ marginTop: 14, padding: 16 }}>
        <b>동작 방식</b>
        <ul style={{ margin: "8px 0 0 18px", fontSize: 13, lineHeight: 1.7, color: "var(--ink2)" }}>
          <li><b>전역 기본값</b> — 제안서에 값이 비어 있으면 이 템플릿의 강조색·제목·섹션 순서를 사용합니다.</li>
          <li><b>브랜드별 오버라이드</b> — 각 제안서 편집에서 <b>강조색·브랜드 로고</b>를 지정하면 그 제안서에만 적용됩니다.</li>
          <li><b>섹션 순서</b> — cover·product·pricing·operations·kpi·creators·closing 중 노출/순서를 조정합니다.</li>
        </ul>
      </div>
    </div>
  );
}
