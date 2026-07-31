import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";
import { STATE_LABELS, type State } from "@/lib/types";

export const dynamic = "force-dynamic";

// 포털 홈 (16 §2) — 진행 상태 + 다음 할 일. brand_id 격리(pq).
export default async function PortalHome() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const brand = (await pq<{ brand_name: string; state: string; next_action: string }>(
    s.brand_id, "SELECT brand_name, state, next_action FROM brands WHERE id=$1"))[0];
  const docs = await pq<{ label: string; done: boolean }>(
    s.brand_id, "SELECT label, done FROM doc_items WHERE brand_id=$1 ORDER BY label").catch(() => []);
  const cycle = (await pq<{ month: string; items_done: number; items_total: number }>(
    s.brand_id, "SELECT month, items_done, items_total FROM ops_cycles WHERE brand_id=$1 ORDER BY month DESC LIMIT 1").catch(() => []))[0];

  const doneDocs = docs.filter((d) => d.done).length;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>{brand?.brand_name}</h1>
      <p style={{ color: "#888", fontSize: 14, marginTop: 4 }}>
        현재 단계: <b>{STATE_LABELS[brand?.state as State] ?? brand?.state}</b>
      </p>

      {brand?.next_action && (
        <div style={card()}>
          <div style={{ fontSize: 12, color: "#e84a80", fontWeight: 700 }}>다음 할 일</div>
          <div style={{ marginTop: 4 }}>{brand.next_action}</div>
        </div>
      )}

      {docs.length > 0 && (
        <div style={card()}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>서류 진행 ({doneDocs}/{docs.length})</div>
          {docs.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 14, padding: "3px 0" }}>
              <span>{d.done ? "✅" : "⬜"}</span><span style={{ color: d.done ? "#888" : "#333" }}>{d.label}</span>
            </div>
          ))}
        </div>
      )}

      {cycle && (
        <div style={card()}>
          <div style={{ fontWeight: 700 }}>이번 달 운영</div>
          <div style={{ fontSize: 14, color: "#555", marginTop: 4 }}>
            {String(cycle.month).slice(0, 7)} · 진행 {cycle.items_done}/{cycle.items_total}
          </div>
        </div>
      )}
    </div>
  );
}

function card(): React.CSSProperties {
  return { background: "#fff", borderRadius: 12, padding: 16, marginTop: 16, boxShadow: "0 1px 3px rgba(0,0,0,.05)" };
}
