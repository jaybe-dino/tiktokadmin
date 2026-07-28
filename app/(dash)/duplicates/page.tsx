import MergeGroup from "@/components/MergeGroup";
import { findDuplicateGroups } from "@/lib/repo/queries";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const groups = await findDuplicateGroups();

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold mb-1">중복 정리</h1>
      <p className="text-sm text-muted mb-4">
        이메일이 달라 자동 매칭되지 않았지만 <b>전화·사업자번호·브랜드명이 같은</b> 카드들입니다.
        유지할 카드를 고르고 병합하면 자료·이력·결제·제안서가 <b>하나의 고객 카드</b>로 합쳐집니다.
      </p>
      {groups.length === 0 ? (
        <div className="card p-6 text-center text-muted">중복 후보가 없습니다 🎉 모든 데이터가 고객별로 잘 매칭돼 있습니다.</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g, i) => (
            <MergeGroup key={`${g.kind}-${g.key}-${i}`} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}
