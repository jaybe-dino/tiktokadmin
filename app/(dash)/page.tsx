import Board from "@/components/Board";
import { boardCards } from "@/lib/repo/queries";
import { loadSlaPolicies } from "@/lib/sla";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  let cards;
  let sla: Record<string, number> = {};
  let me: string | null = null;
  let canForce = false;
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

  return <Board cards={active} sla={sla} me={me} canForce={canForce} />;
}
