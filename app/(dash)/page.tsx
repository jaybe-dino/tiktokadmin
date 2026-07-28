import Link from "next/link";
import Board from "@/components/Board";
import { boardCards } from "@/lib/repo/queries";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const cards = await boardCards();
  const active = cards.filter((c) => c.state !== "dropped" && c.state !== "churned");
  const dropped = cards.filter((c) => c.state === "dropped" || c.state === "churned");

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold">파이프라인 보드</h1>
          <p className="text-sm text-muted">
            카드를 드래그해 상태를 이동 · 게이트 미충족 시 반려됩니다 (활성 {active.length} · 종료 {dropped.length})
          </p>
        </div>
        <Link href="/import" className="btn btn-primary">+ 브랜드 추가</Link>
      </div>
      {active.length === 0 && (
        <div className="card p-6 text-center text-muted mb-4">
          아직 브랜드가 없습니다. <Link href="/import" className="text-pink font-semibold underline">데이터 가져오기</Link>에서
          직접 추가하거나 CSV로 불러오세요. 사이트 연동이 붙으면 자동으로 쌓입니다.
        </div>
      )}
      <Board cards={active} />
    </div>
  );
}
