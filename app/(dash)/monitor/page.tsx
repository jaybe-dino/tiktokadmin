import Link from "next/link";
import AlertActions from "@/components/AlertActions";
import { TierBadge } from "@/components/badges";
import { monitorData } from "@/lib/repo/queries";
import { humanElapsed } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function MonitorPage() {
  const { alerts, gateViolations } = await monitorData();

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold mb-4">모니터</h1>

      <section className="card p-4 mb-4">
        <h2 className="font-bold mb-2">활성 알림 ({alerts.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-[#efe6ee]">
              <th className="py-2">티어</th><th>브랜드</th><th>종류</th><th>메시지</th><th>경과</th><th></th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-muted">활성 알림 없음 🎉</td></tr>
            )}
            {alerts.map((a) => (
              <tr key={a.id} className={`border-b border-[#f6eef4] ${a.tier >= 3 ? "bg-red-50" : ""}`}>
                <td className="py-2"><TierBadge tier={a.tier} /></td>
                <td><Link href={`/brand/${a.brand_id}`} className="font-semibold hover:text-pink">{a.brand_name}</Link></td>
                <td>{a.kind}</td>
                <td className="text-xs">{a.message}</td>
                <td className="text-xs text-muted whitespace-nowrap">{humanElapsed(a.created_at)}</td>
                <td>{a.snoozed_until ? <span className="text-xs text-muted">스누즈됨</span> : <AlertActions alertId={a.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4">
        <h2 className="font-bold mb-2">게이트 위반 로그 (14일)</h2>
        {gateViolations.length === 0 ? (
          <p className="text-sm text-muted">없음</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {gateViolations.map((g, i) => (
                <tr key={i} className="border-b border-[#f6eef4]">
                  <td className="py-1 font-semibold">{g.brand_name}</td>
                  <td className="text-xs">{g.reason}</td>
                  <td className="text-xs text-muted">{g.actor}</td>
                  <td className="text-xs text-muted whitespace-nowrap">{g.at.slice(5, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
