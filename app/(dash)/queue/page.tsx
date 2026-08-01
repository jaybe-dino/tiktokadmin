import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { GradeBadge, StateBadge } from "@/components/badges";
import { currentUser } from "@/lib/auth";
import { ownerFieldForRole } from "@/lib/states";
import { queueBrands, type BoardCard } from "@/lib/repo/queries";
import { query } from "@/lib/db";
import { STATE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY = 86400000;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / DAY);
}

/** 우선순위: 위반 → 오늘마감/초과 → 액션없음 → 그 외 */
function priorityRank(c: BoardCard, today: string): number {
  if (c.has_breach) return 0;
  if (c.due_date && c.due_date <= today) return 1;
  if (!c.next_action) return 2;
  return 3;
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

  const breaches = cards.filter((c) => c.has_breach).length;
  const dueToday = cards.filter((c) => c.due_date === today).length;
  const noAction = cards.filter((c) => !c.next_action).length;

  const ownersOf = (c: BoardCard): string => {
    const ids = [c.owner_intake, c.owner_sales, c.owner_onboard, c.owner_ads].filter(
      (x): x is string => !!x,
    );
    const names = ids.map((id) => nameById.get(id) ?? id);
    // 중복 제거
    return [...new Set(names)].join(", ");
  };

  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="워크큐 — 내 할 일"
        desc={`${user.name} (${user.role}) · 시스템이 계산한 "지금 해야 할 것" 우선순위 순 · 처리하면 자동으로 사라집니다`}
      />

      <div className="flex gap-2 mb-4 flex-wrap">
        <span className="chip chip-red">위반 {breaches}</span>
        <span className="chip chip-amb">오늘마감 {dueToday}</span>
        <span className="chip">액션없음 {noAction}</span>
        <span className="chip">전체 {cards.length}</span>
      </div>

      <div className="card">
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 44 }}>우선</th>
              <th>브랜드</th>
              <th>지금 할 한 가지</th>
              <th style={{ width: 96 }}>문제</th>
              <th style={{ width: 72 }}>경과</th>
              <th style={{ width: 56 }}>SLA</th>
              <th style={{ width: 150 }}>담당</th>
              <th style={{ width: 80 }}>액션</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="note">담당 브랜드 없음 — 워크큐가 비어 있습니다</div>
                </td>
              </tr>
            )}
            {sorted.map((c, i) => {
              const rank = priorityRank(c, today);
              const elapsed = daysSince(c.stage_entered_at);
              const overdue = !!c.due_date && c.due_date < today;
              const isDueToday = c.due_date === today;

              // 문제 chip
              let issue: { label: string; cls: string };
              if (c.has_breach) issue = { label: "SLA 위반", cls: "chip chip-red" };
              else if (overdue) issue = { label: "마감초과", cls: "chip chip-red" };
              else if (isDueToday) issue = { label: "오늘마감", cls: "chip chip-amb" };
              else if (!c.next_action) issue = { label: "액션없음", cls: "chip" };
              else issue = { label: STATE_LABELS[c.state], cls: "chip" };

              // SLA 티어 배지
              let sla: { label: string; cls: string };
              if (c.has_breach) sla = { label: "T3", cls: "sla t3" };
              else if (overdue || isDueToday) sla = { label: "T2", cls: "sla t2" };
              else sla = { label: "T1", cls: "sla t1" };

              const owners = ownersOf(c);
              const initial = (c.brand_name ?? "?").trim().slice(0, 1);
              const elapsedRed = c.has_breach || overdue || (elapsed !== null && elapsed >= 7);

              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700, color: "var(--ink3)" }}>{i + 1}</td>
                  <td>
                    <Link href={`/brand/${c.id}`} style={{ fontWeight: 700 }}>
                      {c.brand_name}
                    </Link>{" "}
                    <GradeBadge grade={c.grade} />
                    <div className="ss" style={{ marginTop: 2 }}>
                      <StateBadge state={c.state} />
                    </div>
                  </td>
                  <td>
                    {c.next_action ? (
                      c.next_action
                    ) : (
                      <span style={{ color: "var(--ink3)" }}>다음 액션 미설정 — 지정 필요</span>
                    )}
                    {c.due_date && (
                      <div className="ss" style={{ marginTop: 2, color: "var(--ink3)" }}>
                        마감 {c.due_date}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={issue.cls}>{issue.label}</span>
                  </td>
                  <td
                    style={{
                      fontWeight: 700,
                      color: elapsedRed ? "var(--danger)" : "var(--ink3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {elapsed === null ? "–" : `${elapsed}일`}
                  </td>
                  <td>
                    <span className={sla.cls}>{sla.label}</span>
                  </td>
                  <td>
                    {owners ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="av">{initial}</span>
                        <span className="ss">{owners}</span>
                      </span>
                    ) : (
                      <span className="ss" style={{ color: "var(--ink3)" }}>
                        미배정
                      </span>
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/brand/${c.id}`}
                      className={`btn btn-sm ${rank <= 1 ? "btn-primary" : ""}`}
                    >
                      열기
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 10 }}>
        🔕 우선순위는 위반 → 오늘마감 → 액션없음 순으로 자동 계산됩니다 · 처리하면 큐에서 사라집니다
      </div>
    </div>
  );
}
