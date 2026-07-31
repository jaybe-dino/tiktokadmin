import Link from "next/link";
import ScreenHeader, { won } from "@/components/ScreenHeader";
import { allProposals } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "chip-amb" }, sent: { ko: "발송됨", c: "chip" }, accepted: { ko: "수락", c: "chip-grn" },
  rejected: { ko: "거절", c: "chip-red" }, superseded: { ko: "대체됨", c: "" },
};

export default async function ProposalsPage() {
  const rows = (await allProposals().catch(() => [])) as Record<string, unknown>[];
  return (
    <div>
      <ScreenHeader title="제안서" desc={`총 ${rows.length}건 · computeQuote 단일 원천`} />
      <div className="card overflow-x-auto">
        <table className="t">
          <thead><tr><th>브랜드</th><th>플랜</th><th>국가</th><th>견적</th><th>상태</th><th>발송</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} style={{ color: "var(--ink3)" }}>제안서가 없습니다.</td></tr>}
            {rows.map((p) => (
              <tr key={p.id as string}>
                <td>
                  <Link href={`/brand/${p.brand_id}`} className="font-semibold hover:underline">{p.brand_name as string}</Link>
                  {p.grade ? <span className={`gr gr-${p.grade} ml-2`}>{p.grade as string}</span> : null}
                </td>
                <td>{p.plan as string}</td>
                <td>{((p.countries as string[]) ?? []).join(", ") || "—"}</td>
                <td className="font-semibold">{won(p.amount as number)}</td>
                <td><span className={`pill ${ST[p.status as string]?.c ?? ""}`}>{ST[p.status as string]?.ko ?? (p.status as string)}</span></td>
                <td style={{ color: "var(--ink3)" }}>{p.sent_at ? new Date(p.sent_at as string).toLocaleDateString("ko-KR") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
