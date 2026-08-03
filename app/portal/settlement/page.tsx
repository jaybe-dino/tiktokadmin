import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";
import DisputeButton from "./DisputeButton";

export const dynamic = "force-dynamic";

const STATUS_KO: Record<string, string> = {
  draft: "작성중", confirmed: "확정", invoiced: "청구", paid: "지급완료", disputed: "이의제기",
};
function settleChip(status: string): string {
  switch (status) {
    case "confirmed": case "paid": return "cellchip cc-ok";
    case "disputed": return "cellchip cc-exp";
    default: return "cellchip cc-ing";
  }
}

// 포털 정산 리포트 (v3.1 s-portal '💰 정산 리포트') — 합계만 노출(수수료 내역 비노출, 16 §4).
//   이의 제기(기존 기능)는 유지. brand_id 격리(pq).
export default async function PortalSettlement() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const rows = await pq<{ id: string; month: string; total: number; status: string }>(
    s.brand_id, "SELECT id::text, month, total, status FROM settlements WHERE brand_id=$1 ORDER BY month DESC").catch(() => []);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <b style={{ fontSize: 13.5 }}>💰 정산 리포트</b>
      {rows.length === 0 ? (
        <p style={{ color: "var(--ink3)", fontSize: 12, marginTop: 8 }}>운영 시작 후 매월 이곳에 게시됩니다</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {rows.map((r) => (
            <div key={r.id} className="card">
              <div className="bd">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>{String(r.month).slice(0, 7)}</span>
                  <span className={settleChip(r.status)}>{STATUS_KO[r.status] ?? r.status}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{Number(r.total).toLocaleString("ko-KR")}원</div>
                {r.status !== "disputed" && r.status !== "paid" && <DisputeButton settlementId={r.id} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
