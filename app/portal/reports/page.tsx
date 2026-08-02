import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";

export const dynamic = "force-dynamic";

const CYCLE_STATUS_KO: Record<string, string> = {
  active: "진행중", closed: "마감", paused: "일시정지",
};
const SETTLE_STATUS_KO: Record<string, string> = {
  draft: "작성중", confirmed: "확정", invoiced: "청구", paid: "지급완료", disputed: "이의제기",
};

// 포털 월간 리포트 (16 §2) — 운영 사이클 진행 + 정산 리포트. brand_id 격리(pq).
export default async function PortalReports() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const cycles = await pq<{ month: string; status: string; items_done: number; items_total: number }>(
    s.brand_id,
    "SELECT month, status, items_done, items_total FROM ops_cycles WHERE brand_id=$1 ORDER BY month DESC",
  ).catch(() => []);

  const settlements = await pq<{ id: string; month: string; total: number; status: string }>(
    s.brand_id,
    "SELECT id::text, month, total, status FROM settlements WHERE brand_id=$1 ORDER BY month DESC",
  ).catch(() => []);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>월간 리포트</h1>

      <div style={{ marginBottom: 20 }}>
        <b style={{ fontSize: 13.5 }}>📈 운영 진행</b>
        {cycles.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14, marginTop: 8 }}>운영 리포트가 없습니다. 운영 시작 후 매월 이곳에 게시됩니다.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {cycles.map((c) => {
              const t = Number(c.items_total) || 0;
              const d = Number(c.items_done) || 0;
              const pct = t > 0 ? Math.round((d / t) * 100) : 0;
              return (
                <div key={String(c.month)} style={card()}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>{String(c.month).slice(0, 7)}</span>
                    <span style={{ fontSize: 13, color: "#666" }}>{CYCLE_STATUS_KO[c.status] ?? c.status}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <div className="pr" style={{ flex: 1, minWidth: 0 }}>
                      <i className={pct >= 100 ? "g" : undefined} style={{ width: `${pct}%` }} />
                    </div>
                    <span style={{ fontSize: 12, color: "#666", fontWeight: 700 }}>{d}/{t}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <b style={{ fontSize: 13.5 }}>💰 정산 리포트</b>
        {settlements.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14, marginTop: 8 }}>정산 리포트가 없습니다.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {settlements.map((r) => (
              <div key={r.id} style={card()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>{String(r.month).slice(0, 7)}</span>
                  <span style={{ fontSize: 13, color: "#666" }}>{SETTLE_STATUS_KO[r.status] ?? r.status}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>
                  {Number(r.total).toLocaleString("ko-KR")}원
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function card(): React.CSSProperties {
  return { background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,.05)" };
}
