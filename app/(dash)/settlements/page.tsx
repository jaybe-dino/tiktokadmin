import Link from "next/link";
import ScreenHeader, { won } from "@/components/ScreenHeader";
import { allSettlements } from "@/lib/repo/global";
import RunSettlementButton from "./RunSettlementButton";
import ConfirmSettlementButton from "./ConfirmSettlementButton";

export const dynamic = "force-dynamic";

const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "초안", c: "cc-warn" },
  confirmed: { ko: "확정 ✓", c: "cc-ok" },
  invoiced: { ko: "청구", c: "cc-ing" },
  paid: { ko: "지급완료", c: "cc-ok" },
  disputed: { ko: "이의제기", c: "cc-exp" },
};

export default async function SettlementsPage() {
  const rows = (await allSettlements().catch(() => [])) as Record<string, unknown>[];

  const gmvSum = rows.reduce((s, r) => s + Number(r.gmv ?? 0), 0);
  const feeSum = rows.reduce((s, r) => s + Number(r.fee_amount ?? 0), 0);
  const cnt = (st: string) => rows.filter((r) => r.status === st).length;
  const draftN = cnt("draft");
  const confirmedN = cnt("confirmed");
  const paidN = cnt("paid");
  const anomalyRows = rows.filter((r) => r.anomaly);
  const disputedRows = rows.filter((r) => r.status === "disputed");
  const draftRows = rows.filter((r) => r.status === "draft");

  return (
    <div>
      <ScreenHeader
        title="정산"
        desc="정산 런은 시스템이 초안 생성 — 확정은 반드시 사람(파트장 결재)"
        right={<RunSettlementButton />}
      />

      <div className="grid g4 gap-3.5" style={{ marginBottom: 14 }}>
        <div className="tile">
          <div className="k">정산 대상</div>
          <div className="v">{rows.length}<small>브랜드</small></div>
          <div className="d">초안 {draftN} · 확정 {confirmedN} · 지급 {paidN}</div>
        </div>
        <div className="tile">
          <div className="k">GMV 합계</div>
          <div className="v">{won(gmvSum)}</div>
          <div className="d">정산 런 대상 합산</div>
        </div>
        <div className="tile">
          <div className="k">수수료 수익 (추정)</div>
          <div className="v">{won(feeSum)}</div>
          <div className="d">환불 차감 반영</div>
        </div>
        <div className={`tile${anomalyRows.length ? " alert" : ""}`}>
          <div className="k">이상치</div>
          <div className="v">{anomalyRows.length}<small>건</small></div>
          <div className={`d${anomalyRows.length ? " dn" : ""}`}>정산서에 자동 반영</div>
        </div>
      </div>

      <div className="grid g31 gap-3.5">
        <div className="card overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>브랜드</th><th>기간</th><th>GMV</th><th>수수료</th><th>구독</th><th>지급액</th><th>상태</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} style={{ color: "var(--ink3)" }}>정산 내역이 없습니다.</td></tr>
              )}
              {rows.map((s) => (
                <tr key={s.id as string}>
                  <td>
                    <b>
                      <Link href={`/brand/${s.brand_id}`} className="hover:underline">{s.brand_name as string}</Link>
                    </b>
                    {s.anomaly ? <span className="pill chip-red ml-2">⚠</span> : null}
                  </td>
                  <td>{String(s.month).slice(0, 7)}</td>
                  <td>{won(s.gmv as number)}</td>
                  <td>
                    {won(s.fee_amount as number)}{" "}
                    <span className="text-[11px]" style={{ color: "var(--ink3)" }}>({String(s.fee_pct)}%)</span>
                  </td>
                  <td>{won(s.sub_amount as number)}</td>
                  <td className="font-semibold">{won(s.total as number)}</td>
                  <td><span className={`cellchip ${ST[s.status as string]?.c ?? "cc-no"}`}>{ST[s.status as string]?.ko ?? (s.status as string)}</span></td>
                  <td><Link href={`/brand/${s.brand_id}`} className="btn sm">보기</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "10px 16px" }} className="note">확정 → 파트장 결재 → 브랜드 포털에 리포트 게시 + 발송 기록</div>
        </div>

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="hd"><b>정산 감시 에이전트</b></div>
            <div className="bd" style={{ fontSize: 12 }}>
              <div className="row">
                <span className="ico i-red">💳</span>
                <div><div className="tt">이상치 {anomalyRows.length}건</div><div className="ss">정산서 자동 반영 · 우선 검토 대상</div></div>
              </div>
              <div className="row">
                <span className="ico i-amb">📝</span>
                <div><div className="tt">확정 대기 {draftN}건</div><div className="ss">파트장 결재 후 확정 처리</div></div>
              </div>
              <div className="row">
                <span className="ico i-grn">📈</span>
                <div><div className="tt">지급 완료 {paidN}건 · 확정 {confirmedN}건</div><div className="ss">GMV 합계 {won(gmvSum)}</div></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="hd"><b>이상치 검토</b>{anomalyRows.length ? <span className="chip red">{anomalyRows.length}</span> : null}</div>
            <div className="bd" style={{ fontSize: 12 }}>
              {anomalyRows.length === 0 && <div className="row"><div><div className="ss">검토할 이상치가 없습니다.</div></div></div>}
              {anomalyRows.slice(0, 5).map((s) => (
                <div className="row" key={s.id as string}>
                  <span className="ico i-red">⚠️</span>
                  <div>
                    <div className="tt">{s.brand_name as string} — {String(s.month).slice(0, 7)}</div>
                    <div className="ss">지급액 {won(s.total as number)} · 수수료 {won(s.fee_amount as number)}</div>
                  </div>
                  <div className="rt"><Link href={`/brand/${s.brand_id}`} className="btn sm">진행 보기</Link></div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="hd"><b>이의제기·확정 대기</b>{disputedRows.length ? <span className="chip red">{disputedRows.length}</span> : null}</div>
            <div className="bd" style={{ fontSize: 12 }}>
              {disputedRows.length === 0 && draftRows.length === 0 && (
                <div className="row"><div><div className="ss">진행 중인 이의제기·대기 건이 없습니다.</div></div></div>
              )}
              {disputedRows.slice(0, 3).map((s) => (
                <div className="row" key={s.id as string}>
                  <span className="ico i-red">⛔</span>
                  <div>
                    <div className="tt">{s.brand_name as string} — 이의제기</div>
                    <div className="ss">{String(s.month).slice(0, 7)} · 지급액 {won(s.total as number)}</div>
                  </div>
                  <div className="rt"><Link href={`/brand/${s.brand_id}`} className="btn sm">보기</Link></div>
                </div>
              ))}
              {draftRows.slice(0, 3).map((s) => (
                <div className="row" key={s.id as string}>
                  <span className="ico i-amb">📝</span>
                  <div>
                    <div className="tt">{s.brand_name as string} — 확정 대기</div>
                    <div className="ss">{String(s.month).slice(0, 7)} · 지급액 {won(s.total as number)}</div>
                  </div>
                  <div className="rt"><ConfirmSettlementButton id={s.id as string} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
