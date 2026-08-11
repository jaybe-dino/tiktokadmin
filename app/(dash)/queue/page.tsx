import { currentUser } from "@/lib/auth";
import { ownerFieldForRole } from "@/lib/states";
import { queueBrands, type BoardCard } from "@/lib/repo/queries";
import { query } from "@/lib/db";
import QueueBoard, { type QueueRow } from "./QueueBoard";

export const dynamic = "force-dynamic";

const DAY = 86400000;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / DAY);
}

/** 우선순위: 위반 → 회신 필요 → 오늘마감/초과 → 액션없음 → 그 외 */
function priorityRank(c: BoardCard, today: string): number {
  if (c.has_breach) return 0;
  if (c.has_reply_needed) return 1;
  if (c.due_date && c.due_date <= today) return 2;
  if (!c.next_action) return 3;
  return 4;
}

export default async function QueuePage() {
  const user = (await currentUser())!;
  const ownerField = ownerFieldForRole(user.role);
  const cards = await queueBrands(ownerField, user.id).catch(() => [] as BoardCard[]);

  // 담당 ID → 이름 매핑 (테이블 미적용 시에도 500 방지)
  const admins = (await query<{ id: string; name: string }>(
    "SELECT id, name FROM admin_users",
  ).catch(() => [])) as { id: string; name: string }[];
  const nameById = new Map(admins.map((a) => [a.id, a.name]));

  const today = new Date().toISOString().slice(0, 10);

  const sorted = [...cards].sort((a, b) => {
    const pr = priorityRank(a, today) - priorityRank(b, today);
    if (pr !== 0) return pr;
    return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
  });

  const ownerIdsOf = (c: BoardCard): string[] => {
    const ids = [c.owner_intake, c.owner_sales, c.owner_onboard, c.owner_ads].filter(
      (x): x is string => !!x,
    );
    return [...new Set(ids)];
  };

  const ownersDisplay = (ids: string[]): string =>
    [...new Set(ids.map((id) => nameById.get(id) ?? id))].join(", ");

  const rows: QueueRow[] = sorted.map((c) => {
    const rank = priorityRank(c, today);
    const elapsed = daysSince(c.stage_entered_at);
    const overdue = !!c.due_date && c.due_date < today;
    const isDueToday = c.due_date === today;

    let tier: { label: string; cls: string };
    if (c.has_breach) tier = { label: "T3", cls: "sla t3" };
    else if (c.has_reply_needed) tier = { label: "회신", cls: "sla t2" };
    else if (overdue || isDueToday) tier = { label: "T2", cls: "sla t2" };
    else if (!c.next_action) tier = { label: "T1", cls: "sla t1" };
    else tier = { label: "T0", cls: "sla ok" };

    const ownerIds = ownerIdsOf(c);
    const elapsedRed = c.has_breach || overdue || (elapsed !== null && elapsed >= 7);

    return {
      id: c.id,
      brand_name: c.brand_name,
      grade: c.grade,
      state: c.state,
      next_action: c.next_action,
      due_date: c.due_date,
      owners: ownersDisplay(ownerIds),
      ownerIds,
      rank,
      elapsed,
      elapsedRed,
      tier,
      // 유형 필터 태그 (유형 컬럼 = 상태 기준)
      sla: c.has_breach || overdue || isDueToday,
      approve: c.state === "contract_review" || c.state === "contract_done",
      docs: c.state === "docs" || c.state === "setup",
      replyNeeded: !!c.has_reply_needed,
    };
  });

  // 담당 필터 옵션: 본인(나) + 현재 목록에 등장하는 담당자.
  const ownerOptions: { id: string; name: string }[] = [
    { id: user.id, name: `${user.name} (나)` },
  ];
  const seen = new Set<string>([user.id]);
  for (const r of rows) {
    for (const id of r.ownerIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ownerOptions.push({ id, name: nameById.get(id) ?? id });
    }
  }

  return (
    <div className="max-w-6xl">
      <QueueBoard
        rows={rows}
        ownerOptions={ownerOptions}
        defaultOwner={user.id}
        userName={user.name}
        userRole={user.role}
      />

      <div className="note" style={{ marginTop: 10 }}>
        🔕 우선순위는 위반 → 오늘마감 → 액션없음 순으로 자동 계산됩니다 · 카드를 열어 처리하면 큐에서 사라집니다
      </div>
    </div>
  );
}
