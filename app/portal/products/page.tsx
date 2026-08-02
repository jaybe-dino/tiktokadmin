import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";

export const dynamic = "force-dynamic";

const PRODUCT_STATUS_KO: Record<string, string> = {
  active: "판매중", paused: "일시중지", discontinued: "단종",
};
const CERT_STATUS_KO: Record<string, string> = {
  none: "미준비", preparing: "준비중", submitted: "제출됨", ready: "완료", rejected: "반려", expired: "만료",
};
function certChip(status: string): string {
  switch (status) {
    case "ready": return "cellchip cc-ok";
    case "submitted": return "cellchip cc-ing";
    case "preparing": return "cellchip cc-warn";
    case "rejected": return "cellchip cc-exp";
    case "expired": return "cellchip cc-exp";
    default: return "cellchip cc-no";
  }
}

type ProductRow = { id: string; name_kr: string; name_en: string; category: string; status: string } & Record<string, unknown>;
type CertRow = { product_id: string; country: string; cert_type: string; status: string } & Record<string, unknown>;

// 포털 제품·인증 현황 (16 §2) — 제품별 국가 인증 현황(읽기 전용). brand_id 격리(pq).
export default async function PortalProducts() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const products = await pq<ProductRow>(
    s.brand_id,
    "SELECT id::text, name_kr, name_en, category, status FROM products_master WHERE brand_id=$1 ORDER BY created_at DESC",
  ).catch(() => []);

  const certs = await pq<CertRow>(
    s.brand_id,
    `SELECT pc.product_id::text AS product_id, pc.country, pc.cert_type, pc.status
       FROM product_certs pc JOIN products_master pm ON pm.id = pc.product_id
      WHERE pm.brand_id=$1 ORDER BY pc.country, pc.cert_type`,
  ).catch(() => []);

  const byProduct = new Map<string, CertRow[]>();
  for (const c of certs) {
    const arr = byProduct.get(c.product_id) ?? [];
    arr.push(c);
    byProduct.set(c.product_id, arr);
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>제품·인증 현황</h1>

      {products.length === 0 ? (
        <p style={{ color: "#888", fontSize: 14 }}>등록된 제품이 없습니다.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {products.map((p) => {
            const pc = byProduct.get(p.id) ?? [];
            return (
              <div key={p.id} style={card()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{p.name_kr}</div>
                    {(p.name_en || p.category) && (
                      <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                        {[p.name_en, p.category].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: "#666" }}>{PRODUCT_STATUS_KO[p.status] ?? p.status}</span>
                </div>

                {pc.length === 0 ? (
                  <div className="note" style={{ marginTop: 10 }}>등록된 인증 항목이 없습니다.</div>
                ) : (
                  <table className="t" style={{ width: "100%", marginTop: 10 }}>
                    <tbody>
                      {pc.map((c, i) => (
                        <tr key={`${c.country}-${c.cert_type}-${i}`}>
                          <td style={{ fontWeight: 700 }}>{c.country}</td>
                          <td>{c.cert_type}</td>
                          <td style={{ textAlign: "right" }}>
                            <span className={certChip(c.status)}>{CERT_STATUS_KO[c.status] ?? c.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function card(): React.CSSProperties {
  return { background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,.05)" };
}
