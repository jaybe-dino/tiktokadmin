import ScreenHeader from "@/components/ScreenHeader";
import { opsDashboard, monthFirst } from "@/lib/operations";
import { PLAN_LABELS, type Plan } from "@/lib/types";

export const dynamic = "force-dynamic";

// 사이클 상태 한글 라벨 (0009_operations: active|closed|paused)
const CYCLE_STATUS_LABELS: Record<string, string> = {
  active: "진행중",
  closed: "마감",
  paused: "일시중지",
};

// 이행률 색토큰 (색상표 --danger/--warn/--ok)
function rateColor(rate: number): string {
  return rate < 50 ? "var(--danger)" : rate < 80 ? "var(--warn)" : "var(--ok)";
}

// 운영 사이클 대시보드 (15 §6) — 브랜드×이행률 히트맵.
export default async function OpsPage() {
  const month = monthFirst();
  const rows = await opsDashboard(month).catch(() => []);

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="운영 사이클"
        desc={`${month.slice(0, 7)} · 운영중 브랜드 월간 이행률`}
      />

      {rows.length === 0 ? (
        <div className="card card-bd text-sm" style={{ color: "var(--ink3)" }}>
          이번 달 사이클이 없습니다. 매월 1일 <code>/api/cron/cycle-open</code> 이 운영중(live_*) 브랜드에 자동 발행합니다.
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="t">
            <thead>
              <tr>
                <th>브랜드</th>
                <th>플랜</th>
                <th>이행</th>
                <th>이행률</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rate = Math.min(100, r.rate);
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.brand_name}</td>
                    <td>{PLAN_LABELS[r.plan as Plan] ?? r.plan}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.items_done}/{r.items_total}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="pr" style={{ width: 96 }}>
                          <i style={{ width: `${rate}%`, background: rateColor(r.rate) }} />
                        </div>
                        <span style={{ color: rateColor(r.rate), fontWeight: 700 }}>{r.rate}%</span>
                      </div>
                    </td>
                    <td>
                      <span className="pill" style={{ background: "#f1f5f9", color: "var(--ink2)" }}>
                        {CYCLE_STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
