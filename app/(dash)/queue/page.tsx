import Link from "next/link";
import { GradeBadge, StateBadge } from "@/components/badges";
import { currentUser } from "@/lib/auth";
import { ownerFieldForRole } from "@/lib/states";
import { queueBrands, type BoardCard } from "@/lib/repo/queries";
import { query } from "@/lib/db";

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

  const ownersOf = (c: BoardCard): string => {
    const ids = [c.owner_intake, c.owner_sales, c.owner_onboard, c.owner_ads].filter(
      (x): x is string => !!x,
    );
    const names = ids.map((id) => nameById.get(id) ?? id);
    return [...new Set(names)].join(", ");
  };

  return (
    <div className="max-w-6xl">
      <div className="ph">
        <div>
          <h1>워크큐 — 내 할 일</h1>
          <p>
            {user.name} ({user.role}) · 시스템이 계산한 &quot;지금 해야 할 것&quot; 우선순위 순.
            처리하면 자동으로 사라집니다.
          </p>
        </div>
        <div className="bar" style={{ margin: 0 }}>
          <select defaultValue="me">
            <option value="me">{user.name} (나)</option>
          </select>
          <select defaultValue="all">
            <option value="all">전체 유형</option>
            <option value="sla">SLA</option>
            <option value="approve">승인</option>
            <option value="docs">서류</option>
          </select>
        </div>
      </div>

      <div className="card">
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 44 }}>우선</th>
              <th>브랜드</th>
              <th>할 일</th>
              <th style={{ width: 96 }}>유형</th>
              <th style={{ width: 72 }}>경과</th>
              <th style={{ width: 56 }}>티어</th>
              <th style={{ width: 190 }}>액션</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="note">담당 브랜드 없음 — 워크큐가 비어 있습니다</div>
                </td>
              </tr>
            )}
            {sorted.map((c, i) => {
              const rank = priorityRank(c, today);
              const elapsed = daysSince(c.stage_entered_at);
              const overdue = !!c.due_date && c.due_date < today;
              const isDueToday = c.due_date === today;

              // 티어 배지 (T0~T3)
              let tier: { label: string; cls: string };
              if (c.has_breach) tier = { label: "T3", cls: "sla t3" };
              else if (overdue || isDueToday) tier = { label: "T2", cls: "sla t2" };
              else if (!c.next_action) tier = { label: "T1", cls: "sla t1" };
              else tier = { label: "T0", cls: "sla ok" };

              const owners = ownersOf(c);
              const elapsedRed =
                c.has_breach || overdue || (elapsed !== null && elapsed >= 7);

              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700, color: "var(--ink3)" }}>{i + 1}</td>
                  <td>
                    <Link href={`/brand/${c.id}`} style={{ fontWeight: 700 }}>
                      {c.brand_name}
                    </Link>{" "}
                    <GradeBadge grade={c.grade} />
                    <span className="sub">{owners ? owners : "미배정"}</span>
                  </td>
                  <td>
                    {c.next_action ? (
                      c.next_action
                    ) : (
                      <span style={{ color: "var(--ink3)" }}>
                        다음 액션 미설정 — 지정 필요
                      </span>
                    )}
                    {c.due_date && (
                      <span className="sub">마감 {c.due_date}</span>
                    )}
                  </td>
                  <td>
                    <StateBadge state={c.state} />
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
                    <span className={tier.cls}>{tier.label}</span>
                  </td>
                  <td>
                    <Link
                      href={`/brand/${c.id}`}
                      className={`btn sm ${rank <= 1 ? "pri" : ""}`}
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
