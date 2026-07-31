import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allContracts } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { mall: "멀티몰", onboarding: "온보딩", guarantee: "Guarantee", marketing: "마케팅", marketing_retainer: "마케팅 리테이너" };
const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "chip-amb" }, review: { ko: "검토", c: "chip-amb" }, sent: { ko: "발송", c: "chip" },
  signed: { ko: "체결", c: "chip-grn" }, expired: { ko: "만료", c: "" }, terminated: { ko: "해지", c: "chip-red" },
};

export default async function ContractsPage() {
  const rows = (await allContracts().catch(() => [])) as Record<string, unknown>[];
  return (
    <div>
      <ScreenHeader title="계약·결제" desc={`총 ${rows.length}건 · terms.fee_pct 는 정산 계산 원천`} />
      <div className="card overflow-x-auto">
        <table className="t">
          <thead><tr><th>브랜드</th><th>종류</th><th>수수료</th><th>기간</th><th>상태</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>계약이 없습니다.</td></tr>}
            {rows.map((c) => {
              const terms = (c.terms as { fee_pct?: number }) ?? {};
              return (
                <tr key={c.id as string}>
                  <td><Link href={`/brand/${c.brand_id}`} className="font-semibold hover:underline">{c.brand_name as string}</Link></td>
                  <td>{KIND[c.kind as string] ?? (c.kind as string)}</td>
                  <td>{terms.fee_pct ?? "—"}%</td>
                  <td style={{ color: "var(--ink3)" }}>{(c.start_date as string) ?? "—"} ~ {(c.end_date as string) ?? "—"}</td>
                  <td><span className={`pill ${ST[c.status as string]?.c ?? ""}`}>{ST[c.status as string]?.ko ?? (c.status as string)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
