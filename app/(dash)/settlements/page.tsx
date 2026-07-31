import Link from "next/link";
import ScreenHeader, { won } from "@/components/ScreenHeader";
import { allSettlements } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "chip-amb" }, confirmed: { ko: "확정", c: "chip" }, invoiced: { ko: "청구", c: "chip" },
  paid: { ko: "지급완료", c: "chip-grn" }, disputed: { ko: "이의제기", c: "chip-red" },
};

export default async function SettlementsPage() {
  const rows = (await allSettlements().catch(() => [])) as Record<string, unknown>[];
  const total = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const anomalies = rows.filter((r) => r.anomaly).length;
  return (
    <div>
      <ScreenHeader title="정산" desc="월별 정산 런 · fee_pct × GMV + 구독분 · 이상치 우선 검토" />
      <div className="grid grid-cols-3 gap-3.5 mb-4">
        <div className="tile"><div className="tile-k">정산 건수</div><div className="tile-v">{rows.length}</div></div>
        <div className="tile"><div className="tile-k">합계</div><div className="tile-v">{won(total)}</div></div>
        <div className="tile" style={anomalies ? { borderLeft: "4px solid var(--danger)" } : undefined}>
          <div className="tile-k">이상치</div><div className="tile-v">{anomalies}</div></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="t">
          <thead><tr><th>월</th><th>브랜드</th><th>GMV</th><th>수수료</th><th>구독</th><th>합계</th><th>상태</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} style={{ color: "var(--ink3)" }}>정산 내역이 없습니다.</td></tr>}
            {rows.map((s) => (
              <tr key={s.id as string}>
                <td>{String(s.month).slice(0, 7)}</td>
                <td><Link href={`/brand/${s.brand_id}`} className="hover:underline">{s.brand_name as string}</Link>{s.anomaly ? <span className="pill chip-red ml-2">⚠</span> : null}</td>
                <td>{won(s.gmv as number)}</td>
                <td>{won(s.fee_amount as number)} <span className="text-[11px]" style={{ color: "var(--ink3)" }}>({String(s.fee_pct)}%)</span></td>
                <td>{won(s.sub_amount as number)}</td>
                <td className="font-semibold">{won(s.total as number)}</td>
                <td><span className={`pill ${ST[s.status as string]?.c ?? ""}`}>{ST[s.status as string]?.ko ?? (s.status as string)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
