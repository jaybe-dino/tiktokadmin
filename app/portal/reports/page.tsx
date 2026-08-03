import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";

export const dynamic = "force-dynamic";

const SETTLE_STATUS_KO: Record<string, string> = {
  draft: "작성중", confirmed: "확정", invoiced: "청구", paid: "지급완료", disputed: "이의제기",
};
function settleChip(status: string): string {
  switch (status) {
    case "confirmed": case "paid": return "cellchip cc-ok";
    case "disputed": return "cellchip cc-exp";
    default: return "cellchip cc-ing";
  }
}

// 포털 정산 리포트 (v3.1 s-portal '💰 정산 리포트') — 매월 게시되는 리포트 목록.
//   v3.1 에서 운영 진행(사이클) 섹션은 제거됨. brand_id 격리(pq).
export default async function PortalReports() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const settlements = await pq<{ id: string; month: string; total: number; status: string }>(
    s.brand_id,
    "SELECT id::text, month, total, status FROM settlements WHERE brand_id=$1 ORDER BY month DESC",
  ).catch(() => []);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <b style={{ fontSize: 13.5 }}>💰 정산 리포트</b>
      {settlements.length === 0 ? (
        <p style={{ color: "var(--ink3)", fontSize: 12, marginTop: 8 }}>운영 시작 후 매월 이곳에 게시됩니다</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {settlements.map((r) => (
            <div key={r.id} className="card">
              <div className="bd">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>{String(r.month).slice(0, 7)}</span>
                  <span className={settleChip(r.status)}>{SETTLE_STATUS_KO[r.status] ?? r.status}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>
                  {Number(r.total).toLocaleString("ko-KR")}원
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
