import Link from "next/link";
import { insightsData } from "@/lib/repo/queries";
import { STATE_LABELS, SOURCE_LABELS, type State } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const { funnel, bySource, insights, churnRisk } = await insightsData();
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold mb-4">인사이트</h1>

      <section className="card p-4 mb-4">
        <h2 className="font-bold mb-2">퍼널 (단계별 브랜드 수 · 평균 체류일)</h2>
        <div className="space-y-1">
          {funnel
            .filter((f) => f.state !== "dropped" && f.state !== "churned")
            .map((f) => (
              <div key={f.state} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0">{STATE_LABELS[f.state as State] ?? f.state}</span>
                <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                  <div className="h-full bg-pink/70" style={{ width: `${(f.count / maxCount) * 100}%` }} />
                </div>
                <span className="w-10 text-right">{f.count}</span>
                <span className="w-20 text-right text-xs text-muted">{f.avg_days ?? "—"}일</span>
              </div>
            ))}
        </div>
      </section>

      <section className="card p-4 mb-4">
        <h2 className="font-bold mb-2">유입경로 × 계약도달</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-[#efe6ee]">
              <th className="py-2">유입경로</th><th>전체</th><th>계약도달</th><th>전환율</th>
            </tr>
          </thead>
          <tbody>
            {bySource.map((s) => (
              <tr key={s.source} className="border-b border-[#f6eef4]">
                <td className="py-1">{SOURCE_LABELS[s.source] ?? s.source}</td>
                <td>{s.total}</td>
                <td>{s.reached_contract}</td>
                <td>{s.total ? `${Math.round((s.reached_contract / s.total) * 100)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="font-bold mb-2">주간 자가학습 인사이트</h2>
          {insights.length === 0 ? (
            <p className="text-sm text-muted">아직 없음 (④ 주간 에이전트가 축적)</p>
          ) : (
            insights.map((ins) => (
              <div key={ins.id} className="border-b border-[#f6eef4] py-2 text-sm">
                <div className="text-xs text-muted">{ins.week} · {ins.metric}</div>
                <div>{ins.finding}</div>
                {ins.proposed_action && <div className="text-pink text-xs mt-1">제안: {ins.proposed_action}</div>}
              </div>
            ))
          )}
        </section>

        <section className="card p-4">
          <h2 className="font-bold mb-2">이탈위험 (high)</h2>
          {churnRisk.length === 0 ? (
            <p className="text-sm text-muted">없음</p>
          ) : (
            churnRisk.map((c) => (
              <div key={c.id} className="flex justify-between border-b border-[#f6eef4] py-1 text-sm">
                <Link href={`/brand/${c.id}`} className="font-semibold hover:text-pink">{c.brand_name}</Link>
                <span className="text-xs text-muted">{STATE_LABELS[c.state as State] ?? c.state}</span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
