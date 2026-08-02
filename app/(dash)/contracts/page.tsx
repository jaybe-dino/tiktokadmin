import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { allContracts } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { mall: "멀티몰", onboarding: "온보딩", guarantee: "Guarantee", marketing: "마케팅", marketing_retainer: "마케팅 리테이너" };
const CC: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "cc-warn" }, review: { ko: "검토", c: "cc-warn" }, sent: { ko: "발송·대기", c: "cc-warn" },
  signed: { ko: "서명 완료", c: "cc-ok" }, expired: { ko: "만료", c: "cc-exp" }, terminated: { ko: "해지", c: "cc-exp" },
};

function ym(d: unknown): string {
  const s = typeof d === "string" ? d : "";
  return s.length >= 7 ? s.slice(0, 7) : "";
}

export default async function ContractsPage() {
  const rows = (await allContracts().catch(() => [])) as Record<string, unknown>[];
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const signedThisMonth = rows.filter((c) => ym(c.signed_at) === curYm).length;
  const signedTotal = rows.filter((c) => c.status === "signed").length;
  const brandNames = Array.from(new Set(rows.map((c) => c.brand_name as string).filter(Boolean)));

  return (
    <div>
      <ScreenHeader
        title="계약·결제"
        desc="계약 조건은 구조화 저장 · 카드결제(온보딩·개런티·구독)는 glovek 수납 → 웹훅 자동 확인 · 계약서·이체는 수기 확인"
        right={<button className="btn pri">+ 계약 등록</button>}
      />
      <div className="grid g31">
        {/* 좌측: 계약 목록 */}
        <div className="card overflow-x-auto">
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
                    <td><Link href={`/brand/${c.brand_id}`} className="hover:underline"><b>{c.brand_name as string}</b></Link></td>
                    <td>{KIND[c.kind as string] ?? (c.kind as string) ?? "—"}</td>
                    <td>{(c.start_date as string) ?? "—"} ~ {(c.end_date as string) ?? "—"}</td>
                    <td>수수료 {terms.fee_pct ?? "—"}%{c.signed_at ? <span className="sub">체결 {ym(c.signed_at)}</span> : <span className="sub">미체결</span>}</td>
                    <td><span className={`cellchip ${st.c}`}>{st.ko}</span></td>
                    <td><Link href={`/brand/${c.brand_id}`} className="btn sm">보기</Link></td>
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
            <div className="bd">
              <label className="f">브랜드 / 결제 항목</label>
              <div style={{ display: "flex", gap: 6 }}>
                <select className="f">
                  {brandNames.length === 0 && <option>계약된 브랜드가 없습니다</option>}
                  {brandNames.map((n) => <option key={n}>{n}</option>)}
                </select>
                <select className="f">
                  <option>온보딩 (카드)</option>
                  <option>Guarantee (카드)</option>
                  <option>추가 결제 (금액 입력)</option>
                </select>
              </div>
              <label className="f" style={{ marginTop: 8 }}>결제 방식</label>
              <div className="radio sel"><span className="rb" /><div><b>① glovek 카드결제 안내 발송</b><div style={{ color: "var(--ink3)", fontSize: 11 }}>이메일 안내 → 브랜드가 glovek 로그인 → 카드결제 · 결제 완료 시 <b>웹훅 자동 확인 → 상태 자동 전진</b></div></div></div>
              <div className="radio"><span className="rb" /><div><b>② 계약서·계좌이체 (수기 확인)</b><div style={{ color: "var(--ink3)", fontSize: 11 }}>금액·입금일 입력 → <b>수동 확인 → 게이트 충족</b></div></div></div>
              <button className="btn pri" style={{ width: "100%", marginTop: 10 }}>결제 안내 메일 발송</button>
              <div className="note" style={{ marginTop: 8 }}>발송 후 "결제 대기" 상태로 추적 — 미결제 3일 시 리마인더 자동 · 링크 열람 횟수 기록</div>
            </div>
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
