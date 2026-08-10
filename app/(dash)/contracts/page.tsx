import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allContracts } from "@/lib/repo/global";
import { query } from "@/lib/db";
import RegisterContractButton from "./RegisterContractButton";
import PaymentPanel from "./PaymentPanel";
import ContractRowActions from "./ContractRowActions";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { mall: "멀티몰", onboarding: "온보딩", guarantee: "Guarantee", marketing: "마케팅", marketing_retainer: "마케팅 리테이너" };
// 계약 종류 → 트랙 배지 (멀티몰/온보딩/마케팅 3트랙 — guarantee 는 멀티몰 트랙 취급)
const TRACK_BADGE: Record<string, { ko: string; bg: string; fg: string }> = {
  mall: { ko: "멀티몰", bg: "#ccfbf1", fg: "#115e59" },
  guarantee: { ko: "멀티몰", bg: "#ccfbf1", fg: "#115e59" },
  onboarding: { ko: "온보딩", bg: "#ede9fe", fg: "#5b21b6" },
  marketing: { ko: "마케팅", bg: "#fce7f3", fg: "#9d174d" },
  marketing_retainer: { ko: "마케팅", bg: "#fce7f3", fg: "#9d174d" },
};
const CC: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "cc-warn" }, review: { ko: "검토", c: "cc-warn" }, sent: { ko: "발송·대기", c: "cc-warn" },
  signed: { ko: "서명 완료", c: "cc-ok" }, expired: { ko: "만료", c: "cc-exp" }, terminated: { ko: "해지", c: "cc-exp" },
};

function ym(d: unknown): string {
  const s = typeof d === "string" ? d : "";
  return s.length >= 7 ? s.slice(0, 7) : "";
}

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand: filterBrand } = await searchParams;
  const allRows = (await allContracts().catch(() => [])) as Record<string, unknown>[];
  // 브랜드 필터(제안서 "계약으로 →" 딥링크) — 목록만 필터, KPI 는 전체 기준.
  const rows = filterBrand ? allRows.filter((c) => c.brand_id === filterBrand) : allRows;
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const signedThisMonth = allRows.filter((c) => ym(c.signed_at) === curYm).length;
  const signedTotal = allRows.filter((c) => c.status === "signed").length;

  // 결제 안내 대상: 계약이 있는 브랜드(중복 제거, id 기준)
  const contractBrands = Array.from(
    new Map(allRows.filter((c) => c.brand_id).map((c) => [c.brand_id as string, { id: c.brand_id as string, name: (c.brand_name as string) ?? "" }])).values(),
  );
  const filterBrandName = filterBrand ? String(allRows.find((c) => c.brand_id === filterBrand)?.brand_name ?? "선택 브랜드") : "";
  // 계약 등록 대상: 전체 브랜드
  const allBrands = (await query("SELECT id, brand_name FROM brands ORDER BY brand_name LIMIT 1000").catch(() => [])) as { id: string; brand_name: string }[];
  const registerBrands = allBrands.map((b) => ({ id: b.id, name: b.brand_name }));

  return (
    <div>
      <ScreenHeader
        title="계약·결제"
        desc="계약 조건은 구조화 저장 · 카드결제(온보딩·개런티·구독)는 glovek 수납 → 웹훅 자동 확인 · 계약서·이체는 수기 확인"
        right={<RegisterContractButton brands={registerBrands} />}
      />
      <div className="grid g31">
        {/* 좌측: 계약 목록 */}
        <div className="card overflow-x-auto">
          {filterBrand && (
            <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span className="pill">브랜드 필터: {filterBrandName}</span>
              <Link href="/contracts" style={{ color: "var(--accent)" }}>전체 보기 ✕</Link>
            </div>
          )}
          <table className="t">
            <thead>
              <tr><th>브랜드</th><th>계약 종류</th><th>기간</th><th>수수료·결제</th><th>상태</th><th></th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} style={{ color: "var(--ink3)" }}>계약이 없습니다.</td></tr>
              )}
              {rows.map((c) => {
                const terms = (c.terms as { fee_pct?: number }) ?? {};
                const st = CC[c.status as string] ?? { ko: (c.status as string) ?? "—", c: "cc-ing" };
                return (
                  <tr key={c.id as string}>
                    <td>
                      <Link href={`/brand/${c.brand_id}`} className="hover:underline"><b>{c.brand_name as string}</b></Link>
                      {c.proposal_title ? (
                        <div className="sub" title="연결된 운영제안서"><span className="cellchip cc-ing" style={{ fontSize: 10 }}>📄 {c.proposal_title as string}</span></div>
                      ) : null}
                    </td>
                    <td>
                      {(() => {
                        const tb = TRACK_BADGE[c.kind as string];
                        return tb ? (
                          <span className="cellchip" style={{ background: tb.bg, color: tb.fg, marginRight: 6 }}>{tb.ko}</span>
                        ) : null;
                      })()}
                      {KIND[c.kind as string] ?? (c.kind as string) ?? "—"}
                    </td>
                    <td>{(c.start_date as string) ?? "—"} ~ {(c.end_date as string) ?? "—"}</td>
                    <td>수수료 {terms.fee_pct ?? "—"}%{c.signed_at ? <span className="sub">체결 {ym(c.signed_at)}</span> : <span className="sub">미체결</span>}</td>
                    <td><span className={`cellchip ${st.c}`}>{st.ko}</span></td>
                    <td><ContractRowActions id={c.id as string} brandId={c.brand_id as string} status={c.status as string} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "10px 16px" }} className="note">📌 갱신 90일 전 자동 알림 · 총 {rows.length}건 · 서명 완료 {signedTotal}건 · terms.fee_pct 는 정산 계산 원천</div>
        </div>

        {/* 우측: 결제 안내·확인 + 이번 달 체결 */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="hd"><b>결제 안내·확인</b><span style={{ color: "var(--ink3)", fontSize: 11 }}>카드는 glovek 수납 · 수기는 여기서 확인</span></div>
            <PaymentPanel brands={contractBrands} />
          </div>
          <div className="tile">
            <div className="k">이번 달 계약 체결</div>
            <div className="v">{signedThisMonth}<small>건</small></div>
            <div className="d">서명 완료 누적 {signedTotal}건</div>
          </div>
        </div>
      </div>
    </div>
  );
}
