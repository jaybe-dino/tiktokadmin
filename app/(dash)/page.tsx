import Board from "@/components/Board";
import CustomerTable from "@/components/CustomerTable";
import PipelineViewShell from "@/components/PipelineViewShell";
import { boardCards, customersList, adminUserList } from "@/lib/repo/queries";
import { loadSlaPolicies } from "@/lib/sla";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  let cards;
  let sla: Record<string, number> = {};
  let me: string | null = null;
  let canForce = false;
  let canEdit = false;
  try {
    const [c, s, u] = await Promise.all([
      boardCards(),
      loadSlaPolicies().catch(() => ({}) as Record<string, number>),
      currentUser().catch(() => null),
    ]);
    cards = c;
    sla = s;
    me = u?.id ?? null;
    canForce = u?.role === "lead" || u?.role === "exec";
    canEdit = canForce;
  } catch (e) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-lg font-bold text-bad mb-2">보드 로드 오류 (진단)</h1>
        <pre className="text-xs bg-red-50 p-3 rounded overflow-auto whitespace-pre-wrap">{(e as Error).message}</pre>
        <p className="text-sm text-muted mt-2">이 메시지를 복사해 공유해 주세요.</p>
      </div>
    );
  }
  const active = cards.filter((c) => c.state !== "dropped" && c.state !== "churned");

  // 표 뷰용 데이터(브랜드 원장 상위 페이지 + 담당자 목록).
  const [tableData, admins] = await Promise.all([
    customersList({ sort: "updated", page: 1 }).catch(() => ({ rows: [], total: 0, page: 1, pages: 1 })),
    adminUserList().catch(() => []),
  ]);
  const ownerNames = Object.fromEntries(admins.map((a) => [a.id, a.name]));
  const owners = admins.filter((a) => a.name).map((a) => ({ id: a.id, name: a.name }));

  return (
    <PipelineViewShell
      storageKey="sales-pipeline-view"
      board={<Board cards={active} sla={sla} me={me} canForce={canForce} />}
      table={
        <>
          <CustomerTable rows={tableData.rows as unknown as Record<string, unknown>[]} canEdit={canEdit} ownerNames={ownerNames} owners={owners} />
          <div className="note" style={{ marginTop: 8, fontSize: 11.5 }}>
            표 뷰는 최근 업데이트 상위 {tableData.rows.length}건 · 전체 {tableData.total}건 — 전체 목록·필터·CSV는 <a href="/customers">브랜드 원장</a>에서.
          </div>
        </>
      }
    />
  );
}
