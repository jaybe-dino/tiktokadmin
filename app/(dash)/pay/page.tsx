import ScreenHeader, { won } from "@/components/ScreenHeader";
import { payData } from "@/lib/repo/queries";
import { query } from "@/lib/db";
import SubsTable from "./SubsTable";
import ManualPaymentForm from "./ManualPaymentForm";

export const dynamic = "force-dynamic";

export default async function PayPage() {
  const d = await payData().catch(() => ({
    activeSubs: 0,
    pastDue: 0,
    mrr: 0,
    onetimeThisMonth: 0,
    subs: [] as Awaited<ReturnType<typeof payData>>["subs"],
    onetime: [] as Awaited<ReturnType<typeof payData>>["onetime"],
  }));

  const brandRows = (await query(
    "SELECT id, brand_name FROM brands ORDER BY brand_name LIMIT 1000",
  ).catch(() => [])) as { id: string; brand_name: string }[];
  const brands = brandRows.map((b) => ({ id: b.id, name: b.brand_name }));

  return (
    <div>
      <ScreenHeader
        title="결제 현황"
        desc="카드결제(온보딩·개런티·구독)는 glovek 수납 → 웹훅 자동 확인 · 계좌이체·수기는 여기서 확인"
      />

      {/* 상단 스탯 타일 4개 */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="tile">
          <div className="tile-k">활성 구독</div>
          <div className="tile-v">{d.activeSubs}<small style={{ fontSize: 13, fontWeight: 600, color: "var(--ink3)" }}> 건</small></div>
        </div>
        <div className={`tile${d.pastDue > 0 ? " alert" : ""}`}>
          <div className="tile-k">연체 (past_due)</div>
          <div className="tile-v" style={d.pastDue > 0 ? { color: "var(--danger)" } : undefined}>
            {d.pastDue}<small style={{ fontSize: 13, fontWeight: 600, color: "var(--ink3)" }}> 건</small>
          </div>
        </div>
        <div className="tile">
          <div className="tile-k">정기 MRR</div>
          <div className="tile-v">{won(d.mrr)}</div>
        </div>
        <div className="tile">
          <div className="tile-k">이번 달 일회·수기</div>
          <div className="tile-v">{won(d.onetimeThisMonth)}</div>
        </div>
      </div>

      {/* 구독 (정기) 테이블 — 상태 필터·검색·연체 리마인더 */}
      <SubsTable subs={d.subs} />

      {/* 수기 결제 확인 기록 */}
      <ManualPaymentForm brands={brands} />

      {/* 일회·수기 결제 테이블 */}
      <div className="card">
        <div className="card-hd"><b>일회·수기 결제</b></div>
        <table className="t">
          <thead>
            <tr>
              <th>브랜드</th>
              <th>플랜</th>
              <th>금액</th>
              <th>결제일</th>
              <th>구분</th>
            </tr>
          </thead>
          <tbody>
            {d.onetime.length === 0 && (
              <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>없음</td></tr>
            )}
            {d.onetime.map((o, i) => (
              <tr key={i}>
                <td><b>{o.brand_name}</b></td>
                <td>{o.plan}</td>
                <td>{won(o.amount)}</td>
                <td>{o.paid_at ? String(o.paid_at).slice(0, 10) : "—"}</td>
                <td><span className="chip chip-amb">수기</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note" style={{ margin: "0 16px 14px" }}>
          카드는 glovek 수납 · 계좌이체·수기는 여기서 확인 — 미결제 3일 시 리마인더 자동
        </div>
      </div>
    </div>
  );
}
