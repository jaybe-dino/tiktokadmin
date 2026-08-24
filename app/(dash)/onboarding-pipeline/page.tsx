import { onboardingPipeline, ONB_STAGES } from "@/lib/onboarding-pipeline";
import { adminUserList } from "@/lib/repo/queries";
import OnbBoard from "@/components/OnbBoard";
import OnbTable from "@/components/OnbTable";
import PipelineViewShell from "@/components/PipelineViewShell";

export const dynamic = "force-dynamic";

export default async function OnboardingPipelinePage() {
  const [groups, admins] = await Promise.all([
    onboardingPipeline().catch(() => null),
    adminUserList().catch(() => []),
  ]);
  const ownerNames = Object.fromEntries(admins.map((a) => [a.id, a.name]));
  const owners = admins.filter((a) => a.name).map((a) => ({ id: a.id, name: a.name }));

  return (
    <div>
      <div className="ph">
        <div>
          <h1>온보딩 파이프라인</h1>
          <p>영업 파이프라인 서류수급 진입 브랜드부터 — 서류준비/Invite → 기업정보 등록 → 가입 완료 → 제품 등록 → 운영 준비. 단계는 온보딩 신청 진행상태로 자동 파생되며, 드래그로 수동 이동할 수 있습니다.</p>
        </div>
      </div>

      {groups === null ? (
        <div className="card" style={{ padding: 20, color: "var(--ink3)" }}>
          온보딩 데이터를 불러오지 못했습니다 — 온보딩 마이그레이션(0036~0038) 적용이 필요할 수 있습니다.
        </div>
      ) : (
        <PipelineViewShell
          storageKey="onb-pipeline-view"
          board={<OnbBoard stages={ONB_STAGES} groups={groups} ownerNames={ownerNames} owners={owners} />}
          table={<OnbTable stages={ONB_STAGES} groups={groups} owners={owners} />}
        />
      )}

      <div className="note" style={{ marginTop: 8 }}>
        💡 카드를 <b>드래그</b>해 단계를 수동으로 옮길 수 있습니다(수동 이동 시 &lsquo;수동&rsquo; 배지 표시 · ✕ 로 자동 복귀). 클릭하면 브랜드360으로 이동합니다. 단계 전환은 온보딩 신청 승인·제품 등록으로도 자동 진행됩니다.
      </div>
    </div>
  );
}
