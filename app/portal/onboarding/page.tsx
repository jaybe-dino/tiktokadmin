import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";

export const dynamic = "force-dynamic";

// 포털 온보딩 (16 §2) — 제출 서류 체크리스트 + 진행률. brand_id 격리(pq).
export default async function PortalOnboarding() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const brand = (await pq<{ brand_name: string }>(
    s.brand_id, "SELECT brand_name FROM brands WHERE id=$1").catch(() => []))[0];

  const docs = await pq<{ item_key: string; label: string; done: boolean; template: string }>(
    s.brand_id,
    "SELECT item_key, label, done, template FROM doc_items WHERE brand_id=$1 ORDER BY done ASC, label ASC",
  ).catch(() => []);

  const total = docs.length;
  const done = docs.filter((d) => d.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>입점 온보딩</h1>
      {brand?.brand_name && (
        <p style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>{brand.brand_name}</p>
      )}

      {total === 0 ? (
        <p style={{ color: "#888", fontSize: 14 }}>
          아직 제출할 서류가 없습니다. 계약 완료 후 서류 체크리스트가 생성됩니다.
        </p>
      ) : (
        <div style={card()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <b style={{ fontSize: 13.5 }}>📂 제출 서류 현황</b>
            <span style={{ fontSize: 13, color: "#666", fontWeight: 700 }}>{done}/{total} · {pct}%</span>
          </div>

          <div className="pr" style={{ minWidth: 0, marginBottom: 14 }}>
            <i className={pct >= 100 ? "g" : undefined} style={{ width: `${pct}%` }} />
          </div>

          <table className="t" style={{ width: "100%" }}>
            <tbody>
              {docs.map((d) => (
                <tr key={d.item_key}>
                  <td>{d.label}</td>
                  <td style={{ textAlign: "right" }}>
                    {d.done
                      ? <span className="cellchip cc-ok">제출 ✓</span>
                      : <span className="cellchip cc-warn">제출 필요</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {done < total ? (
            <div className="note" style={{ marginTop: 12 }}>
              ℹ️ 남은 서류를 제출하시면 입점 셋업이 진행됩니다. 담당 매니저에게 문의로 파일을 전달해 주세요.
            </div>
          ) : (
            <div className="note" style={{ marginTop: 12 }}>
              ✅ 모든 서류가 제출되었습니다. 셋업이 진행 중입니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function card(): React.CSSProperties {
  return { background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,.05)" };
}
