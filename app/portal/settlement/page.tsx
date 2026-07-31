import { redirect } from "next/navigation";
import { portalSession, pq } from "@/lib/portal-db";
import DisputeButton from "./DisputeButton";

export const dynamic = "force-dynamic";

const STATUS_KO: Record<string, string> = {
  draft: "작성중", confirmed: "확정", invoiced: "청구", paid: "지급완료", disputed: "이의제기",
};

// 포털 정산 명세 (16 §2) — 합계만 노출(수수료 계산 내역 비노출, 16 §4).
export default async function PortalSettlement() {
  const s = await portalSession();
  if (!s) redirect("/portal/login");

  const rows = await pq<{ id: string; month: string; total: number; status: string }>(
    s.brand_id, "SELECT id::text, month, total, status FROM settlements WHERE brand_id=$1 ORDER BY month DESC").catch(() => []);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>정산 명세</h1>
      {rows.length === 0 ? (
        <p style={{ color: "#888", fontSize: 14 }}>정산 내역이 없습니다.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700 }}>{String(r.month).slice(0, 7)}</span>
                <span style={{ fontSize: 13, color: "#666" }}>{STATUS_KO[r.status] ?? r.status}</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{Number(r.total).toLocaleString("ko-KR")}원</div>
              {r.status !== "disputed" && r.status !== "paid" && <DisputeButton settlementId={r.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
