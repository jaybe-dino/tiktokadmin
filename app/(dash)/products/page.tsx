import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allProducts, certRisks } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const [products, risks] = await Promise.all([
    allProducts().catch(() => []) as Promise<Record<string, unknown>[]>,
    certRisks().catch(() => []) as Promise<Record<string, unknown>[]>,
  ]);
  return (
    <div>
      <ScreenHeader title="제품·인증·재고" desc={`제품 ${products.length}종 · 인증 리스크 ${risks.length}건`} />

      {risks.length > 0 && (
        <div className="card mb-4 overflow-hidden" style={{ borderLeft: "4px solid var(--danger)" }}>
          <div className="card-hd"><b className="text-bad">⚠ 인증 리스크 (만료·미비)</b></div>
          <table className="t">
            <thead><tr><th>브랜드</th><th>제품</th><th>국가</th><th>인증</th><th>상태</th><th>만료</th></tr></thead>
            <tbody>
              {risks.map((r) => (
                <tr key={r.id as string}>
                  <td>{r.brand_name as string}</td><td>{r.product as string}</td><td>{r.country as string}</td>
                  <td>{r.cert_type as string}</td>
                  <td><span className="pill chip-red">{r.status as string}</span></td>
                  <td style={{ color: "var(--ink3)" }}>{(r.expires_at as string) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="card-hd"><b>제품 인증 현황</b></div>
        <table className="t">
          <thead><tr><th>브랜드</th><th>제품</th><th>카테고리</th><th>인증 완료율</th></tr></thead>
          <tbody>
            {products.length === 0 && <tr><td colSpan={4} style={{ color: "var(--ink3)" }}>제품이 없습니다.</td></tr>}
            {products.map((p) => {
              const total = (p.cert_total as number) ?? 0;
              const ready = (p.cert_ready as number) ?? 0;
              const pct = total ? Math.round((ready / total) * 100) : 0;
              return (
                <tr key={p.id as string}>
                  <td><Link href={`/brand/${p.brand_id}`} className="hover:underline">{p.brand_name as string}</Link></td>
                  <td className="font-semibold">{p.name_kr as string}</td>
                  <td>{(p.category as string) || "—"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="pr"><i className={pct >= 100 ? "g" : pct >= 50 ? "" : "w"} style={{ width: `${pct}%` }} /></div>
                      <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{ready}/{total}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
