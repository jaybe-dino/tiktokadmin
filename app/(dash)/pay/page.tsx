import Link from "next/link";
import { payData } from "@/lib/repo/queries";

export const dynamic = "force-dynamic";

function won(n: number): string {
  return `₩${Math.round(n).toLocaleString()}`;
}

export default async function PayPage() {
  const d = await payData();

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold mb-4">결제·정산</h1>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Kpi label="정기 MRR" value={won(d.mrr)} />
        <Kpi label="활성 구독" value={`${d.activeSubs}`} />
        <Kpi label="past_due" value={`${d.pastDue}`} bad={d.pastDue > 0} />
        <Kpi label="이번달 일회·수기" value={won(d.onetimeThisMonth)} />
      </div>

      <section className="card p-4 mb-4">
        <h2 className="font-bold mb-2">구독 (정기)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-[#efe6ee]">
              <th className="py-2">브랜드</th><th>플랜</th><th>금액</th><th>다음결제</th><th>실패</th><th>상태</th>
            </tr>
          </thead>
          <tbody>
            {d.subs.length === 0 && <tr><td colSpan={6} className="py-3 text-muted">구독 없음</td></tr>}
            {d.subs.map((s, i) => (
              <tr key={i} className={`border-b border-[#f6eef4] ${s.status === "past_due" ? "bg-red-50" : ""}`}>
                <td className="py-2"><Link href={`/brand/${s.brand_id}`} className="font-semibold hover:text-pink">{s.brand_name}</Link></td>
                <td>{s.plan ?? "—"}</td>
                <td>{s.amount ? won(s.amount) : "—"}</td>
                <td className="text-xs">{s.next_charge_at?.slice(0, 10) ?? "—"}</td>
                <td>{s.failures ?? 0}</td>
                <td>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4">
        <h2 className="font-bold mb-2">일회·수기 결제</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-[#efe6ee]">
              <th className="py-2">브랜드</th><th>플랜</th><th>금액</th><th>일자</th><th>구분</th>
            </tr>
          </thead>
          <tbody>
            {d.onetime.length === 0 && <tr><td colSpan={5} className="py-3 text-muted">없음</td></tr>}
            {d.onetime.map((o, i) => (
              <tr key={i} className="border-b border-[#f6eef4]">
                <td className="py-2 font-semibold">{o.brand_name}</td>
                <td>{o.plan}</td>
                <td>{won(o.amount)}</td>
                <td className="text-xs">{o.paid_at}</td>
                <td>{o.plan === "guarantee_1m" ? <span className="pill bg-amber-100 text-amber-700">수기</span> : o.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kpi({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-xl font-extrabold mt-1 ${bad ? "text-bad" : ""}`}>{value}</div>
    </div>
  );
}
