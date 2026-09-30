// 브랜드360 상단 PM 요약(표시 전용) — 핵심 KPI · 우선 업무 3개 · 장애물 · 답변대기.
//   값이 없는 것은 "미확인" 으로 적는다(0 으로 적지 않는다).
//   기준 시각과 수집 범위(미연결 채널)를 함께 적어, 요약이 놓칠 수 있는 부분을 숨기지 않는다.
import {
  KPI_KIND_LABEL, AGREEMENT_LABEL, kpiGap, periodLabel,
  type PmHeaderSummary,
} from "@/lib/pm-brief";

const kstShort = (iso: string) => {
  try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }); }
  catch { return iso; }
};
const nz = (v: number | null, unit: string) => (v === null ? "미확인" : `${v.toLocaleString("ko-KR")}${unit}`);

export default function BrandPmHeader({ summary }: { summary: PmHeaderSummary }) {
  if (summary.unavailable) {
    return (
      <div className="card" data-testid="pm-header" style={{ marginBottom: 12 }}>
        <div className="bd note" style={{ color: "#c25400" }}>PM 요약 — {summary.unavailable}</div>
      </div>
    );
  }
  const c = summary.counts;
  return (
    <div className="card" data-testid="pm-header" style={{ marginBottom: 12 }}>
      <div className="hd">
        <b>🧭 PM 현황</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          기준 {kstShort(summary.asOf)} (KST) · 열린 업무 {c.openTasks} · 지연 {c.overdue} ·
          고객대기 {c.waitingCustomer} · 내부대기 {c.waitingInternal}
          {c.unconfirmedKpis > 0 && ` · KPI 미확정 ${c.unconfirmedKpis}`}
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 12 }}>
        {/* 핵심 KPI */}
        <div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>핵심 KPI</div>
          {summary.keyKpis.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>등록된 KPI 가 없습니다.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="t" style={{ fontSize: 12 }}>
                <thead><tr><th>구분</th><th>지표</th><th>목표</th><th>현재</th><th>차이</th><th>기간</th><th>담당</th><th>기준일</th></tr></thead>
                <tbody>
                  {summary.keyKpis.map((k) => {
                    const gap = kpiGap(k);
                    return (
                      <tr key={k.id}>
                        <td>
                          <span className="chip" style={{ fontSize: 10.5 }}>{KPI_KIND_LABEL[k.kind]}</span>
                          {k.agreement !== "agreed" && (
                            <span className="cellchip cc-warn" style={{ marginLeft: 4 }}>{AGREEMENT_LABEL[k.agreement]}</span>
                          )}
                        </td>
                        <td><b>{k.name}</b></td>
                        <td>{nz(k.target, k.unit)}</td>
                        <td>{nz(k.current, k.unit)}</td>
                        <td style={{ color: gap === null ? "var(--ink3)" : gap > 0 ? "#c25400" : "#0b7a52" }}>
                          {gap === null ? "산출 불가" : gap > 0 ? `${gap.toLocaleString("ko-KR")}${k.unit} 부족` : "달성"}
                        </td>
                        <td>{periodLabel(k)}</td>
                        <td>{k.owner ?? <span style={{ color: "#c92a2a" }}>미배정</span>}</td>
                        <td>{k.measuredAt ?? <span style={{ color: "var(--ink3)" }}>미기재</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          {/* 우선 업무 3개 */}
          <div>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>지금 할 일 (최대 3)</div>
            {summary.top3.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>대기 중이 아닌 열린 업무가 없습니다.</div>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                {summary.top3.map((t) => (
                  <li key={t.id}>
                    {t.title}
                    <span style={{ color: "var(--ink3)", fontSize: 11 }}>
                      {t.dueDate ? ` · 마감 ${t.dueDate}` : " · 마감 없음"}
                      {t.owner ? ` · ${t.owner}` : " · 담당 미배정"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* 장애물 */}
          <div>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>장애물</div>
            {summary.blockers.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>기록에서 확인된 장애물이 없습니다.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                {summary.blockers.map((b, i) => (
                  <li key={`${b.label}-${i}`} style={{ color: b.severity === 1 ? "#c92a2a" : undefined }}>
                    {b.label}
                    <div style={{ color: "var(--ink3)", fontSize: 11 }}>{b.reason}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 답변대기 */}
          <div>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>답변대기</div>
            {summary.awaiting.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>대기 중인 항목이 없습니다.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                {summary.awaiting.map((a, i) => (
                  <li key={`${a.ref.id}-${i}`}>
                    <span className="chip" style={{ fontSize: 10.5 }}>{a.who === "customer" ? "고객" : "내부"}</span>{" "}
                    {a.label}
                    {a.since && <span style={{ color: "var(--ink3)", fontSize: 11 }}> · {a.since}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {summary.caveats.length > 0 && (
          <div className="note" style={{ fontSize: 11.5, color: "#c25400" }}>
            수집 범위 — {summary.caveats.join(" · ")} (이 요약은 연결된 기록만 봅니다)
          </div>
        )}
      </div>
    </div>
  );
}
