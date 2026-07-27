import QueueRow from "@/components/QueueRow";
import { currentUser } from "@/lib/auth";
import { ownerFieldForRole } from "@/lib/states";
import { queueBrands } from "@/lib/repo/queries";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const user = (await currentUser())!;
  const ownerField = ownerFieldForRole(user.role);
  const cards = await queueBrands(ownerField, user.id);

  const today = new Date().toISOString().slice(0, 10);
  const breaches = cards.filter((c) => c.has_breach).length;
  const dueToday = cards.filter((c) => c.due_date === today).length;
  const noAction = cards.filter((c) => !c.next_action).length;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold mb-1">내 워크큐</h1>
      <p className="text-sm text-muted mb-4">
        {user.name} ({user.role}) · 오늘 움직여야 할 브랜드
      </p>
      <div className="flex gap-2 mb-4">
        <span className="pill bg-red-100 text-bad">위반 {breaches}</span>
        <span className="pill bg-amber-100 text-amber-700">오늘마감 {dueToday}</span>
        <span className="pill bg-gray-100 text-gray-600">액션없음 {noAction}</span>
      </div>
      <div className="space-y-2">
        {cards.length === 0 && <div className="text-sm text-muted">담당 브랜드 없음</div>}
        {cards.map((c) => (
          <QueueRow key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}
