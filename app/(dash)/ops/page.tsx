import { opsDashboard, monthFirst } from "@/lib/operations";

export const dynamic = "force-dynamic";

// 운영 사이클 대시보드 (15 §6) — 브랜드×이행률 히트맵.
export default async function OpsPage() {
  const month = monthFirst();
  const rows = await opsDashboard(month).catch(() => []);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold mb-1">운영 사이클</h1>
      <p className="text-sm text-muted mb-4">{month.slice(0, 7)} · 운영중 브랜드 월간 이행률</p>

      {rows.length === 0 ? (
        <div className="card p-6 text-sm text-muted">
          이번 달 사이클이 없습니다. 매월 1일 <code>/api/cron/cycle-open</code> 이 운영중(live_*) 브랜드에 자동 발행합니다.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-muted">
              <tr><th className="p-3">브랜드</th><th className="p-3">플랜</th><th className="p-3">이행</th><th className="p-3">이행률</th><th className="p-3">상태</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3 font-medium">{r.brand_name}</td>
                  <td className="p-3">{r.plan}</td>
                  <td className="p-3">{r.items_done}/{r.items_total}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(100, r.rate)}%`,
                          background: r.rate < 50 ? "#e5484d" : r.rate < 80 ? "#e6a700" : "#1a8a3f",
                        }} />
                      </div>
                      <span className={r.rate < 50 ? "text-bad font-semibold" : ""}>{r.rate}%</span>
                    </div>
                  </td>
                  <td className="p-3"><span className="pill bg-gray-100">{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
