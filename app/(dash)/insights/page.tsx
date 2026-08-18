import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { GradeBadge, StateBadge } from "@/components/badges";
import InsightApproval from "./InsightApproval";
import PrintReportButton from "./PrintReportButton";
import { insightsData } from "@/lib/repo/queries";
import { query } from "@/lib/db";
import {
  STATES,
  STATE_LABELS,
  SOURCE_LABELS,
  type State,
  type Grade,
} from "@/lib/types";

export const dynamic = "force-dynamic";

// 인사이트 지표 키(machine) → 사람이 읽는 라벨. weeklyInsight 는 metric='funnel' 저장.
const METRIC_LABEL: Record<string, string> = {
  funnel: "퍼널 분석",
  sla: "SLA 점검",
  conversion: "전환 분석",
};

const ACTIVE: State[] = STATES.filter(
  (s) => s !== "dropped" && s !== "churned" && s !== "hold",
) as State[];

export default async function InsightsPage() {
  const { funnel, bySource, insights, churnRisk } = await insightsData();

  // 등급별 계약도달 전환 (인라인 쿼리 · 테이블 미적용 시 빈배열)
  const byGrade = (await query<Record<string, unknown>>(
    `SELECT grade,
            count(*)::int total,
            count(*) FILTER (WHERE state IN ('contract_done','docs','setup','live_mall','live_onboarding','settling'))::int reached_contract
       FROM brands

      GROUP BY grade
      ORDER BY grade`,
  ).catch(() => [] as Record<string, unknown>[])) as Record<string, unknown>[];

  // 파생 통계 ─────────────────────────────
  const funnelMap = new Map<string, { count: number; avg_days: number | null }>();
  for (const f of funnel) funnelMap.set(f.state, { count: f.count, avg_days: f.avg_days });

  // 퍼널 랭킹막대: 활성 단계별 브랜드 수 (max 대비)
  const funnelRows = ACTIVE.map((s) => ({
    state: s,
    count: funnelMap.get(s)?.count ?? 0,
    avg_days: funnelMap.get(s)?.avg_days ?? null,
  }));
  const maxCount = Math.max(1, ...funnelRows.map((r) => r.count));

  // 병목 진단: 평균 체류 상위 (활성 단계)
  const bottleneck = [...funnelRows]
    .filter((r) => r.avg_days !== null && r.count > 0)
    .sort((a, b) => (b.avg_days ?? 0) - (a.avg_days ?? 0))
    .slice(0, 5);

  const pending = insights.filter((i) => i.approved === null).length;

  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="AI 인사이트 — 주간 자가학습"
        desc="매주 월 09:00 자동 생성 · 제안은 사람이 승인해야 반영됩니다"
        right={<PrintReportButton />}
      />

      <div className="grid g31" style={{ gap: 14 }}>
        {/* 좌측 컬럼 */}
        <div style={{ display: "grid", gap: 14 }}>
          {/* 퍼널 — 단계별 브랜드 수 · 평균 체류 */}
          <div className="card">
            <div className="hd"><b>퍼널 — 단계별 브랜드 수 · 평균 체류</b></div>
            <div className="bd">
              {funnelRows.map((r) => (
                <div key={r.state} className="hbar">
                  <span className="lb">{STATE_LABELS[r.state]}</span>
                  <div className="tr">
                    <i style={{ width: `${(r.count / maxCount) * 100}%`, background: "#2563eb" }} />
                  </div>
                  <span className="vl">
                    {r.count}건{" "}
                    <span style={{ color: "var(--ink3)" }}>· {r.avg_days ?? "—"}일</span>
                  </span>
                </div>
              ))}
              <div className="note" style={{ marginTop: 8 }}>
                막대 = 현재 단계에 머무는 브랜드 수 · 우측 = 평균 체류일(stage_entered_at 기준)
              </div>
            </div>
          </div>

          {/* 병목 진단 */}
          <div className="card">
            <div className="hd"><b>병목 진단 — 체류 오래된 단계</b></div>
            <div className="bd" style={{ padding: 0, overflowX: "auto" }}>
              <table className="t">
                <thead>
                  <tr><th>단계</th><th>평균 체류</th><th>브랜드 수</th></tr>
                </thead>
                <tbody>
                  {bottleneck.length === 0 && (
                    <tr><td colSpan={3} style={{ color: "var(--ink3)" }}>데이터 없음</td></tr>
                  )}
                  {bottleneck.map((r, i) => (
                    <tr key={r.state}>
                      <td><StateBadge state={r.state} /></td>
                      <td style={i === 0 ? { color: "var(--danger)", fontWeight: 700 } : undefined}>
                        {r.avg_days}일{i === 0 && " ▲"}
                      </td>
                      <td>{r.count}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 유입 경로별 성과 */}
          <div className="card">
            <div className="hd"><b>유입 경로별 성과 — 계약도달 전환</b></div>
            <div className="bd" style={{ padding: 0, overflowX: "auto" }}>
              <table className="t">
                <thead>
                  <tr><th>경로</th><th>전체</th><th>계약도달</th><th>전환율</th></tr>
                </thead>
                <tbody>
                  {bySource.length === 0 && (
                    <tr><td colSpan={4} style={{ color: "var(--ink3)" }}>데이터 없음</td></tr>
                  )}
                  {bySource.map((s) => {
                    const pct = s.total ? Math.round((s.reached_contract / s.total) * 100) : 0;
                    return (
                      <tr key={s.source}>
                        <td>{SOURCE_LABELS[s.source] ?? s.source}</td>
                        <td>{s.total}</td>
                        <td>{s.reached_contract}</td>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <span className="pr" style={{ width: 60 }}>
                              <i className={pct >= 40 ? "g" : pct >= 20 ? "" : "w"} style={{ width: `${pct}%` }} />
                            </span>
                            <b>{s.total ? `${pct}%` : "—"}</b>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 등급별 계약도달 전환 */}
          <div className="card">
            <div className="hd"><b>등급별 계약도달 전환</b></div>
            <div className="bd" style={{ padding: 0, overflowX: "auto" }}>
              <table className="t">
                <thead>
                  <tr><th>등급</th><th>전체</th><th>계약도달</th><th>전환율</th></tr>
                </thead>
                <tbody>
                  {byGrade.length === 0 && (
                    <tr><td colSpan={4} style={{ color: "var(--ink3)" }}>데이터 없음</td></tr>
                  )}
                  {byGrade.map((g, i) => {
                    const grade = (g.grade as Grade | null) ?? null;
                    const total = (g.total as number) ?? 0;
                    const reached = (g.reached_contract as number) ?? 0;
                    const pct = total ? Math.round((reached / total) * 100) : 0;
                    return (
                      <tr key={(grade ?? "none") + i}>
                        <td><GradeBadge grade={grade} /></td>
                        <td>{total}</td>
                        <td>{reached}</td>
                        <td><b>{total ? `${pct}%` : "—"}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 우측 컬럼 */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {/* AI 위젯 — 이번 주 제안 */}
          <div className="aiw">
            <h5>🤖 이번 주 제안 (승인 필요){pending > 0 && ` · ${pending}`}</h5>
            <div style={{ fontSize: "12.5px", lineHeight: 1.7 }}>
              {insights.length === 0 ? (
                <span style={{ color: "var(--ink3)" }}>
                  아직 축적된 제안이 없습니다 — 주간 자가학습 에이전트가 매주 월 09:00 생성합니다.
                </span>
              ) : (
                insights.slice(0, 6).map((ins) => (
                  <div key={ins.id} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#2563eb" }}>
                      {METRIC_LABEL[ins.metric] ?? ins.metric}
                    </div>
                    <b style={{ display: "block", marginTop: 2, whiteSpace: "pre-wrap" }}>{ins.finding}</b>
                    {ins.proposed_action && (
                      <>
                        <br />
                        <span style={{ color: "#7e22ce" }}>제안: {ins.proposed_action}</span>
                      </>
                    )}
                    <div style={{ display: "flex", gap: 6, margin: "6px 0 0", alignItems: "center" }}>
                      {ins.approved === true ? (
                        <span className="pill chip-grn">승인됨</span>
                      ) : ins.approved === false ? (
                        <span className="pill chip-red">보류됨</span>
                      ) : (
                        <InsightApproval id={ins.id} />
                      )}
                      <span style={{ color: "var(--ink3)", fontSize: 11 }}>{ins.week}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 이탈위험 리스트 */}
          <div className="card">
            <div className="hd">
              <b>이탈위험 (high)</b>
              {churnRisk.length > 0 && <span className="pill chip-red">{churnRisk.length}</span>}
            </div>
            <div className="bd">
              {churnRisk.length === 0 ? (
                <p style={{ color: "var(--ink3)", fontSize: "12.5px" }}>현재 high 위험 브랜드가 없습니다.</p>
              ) : (
                churnRisk.map((c) => (
                  <div key={c.id} className="row">
                    <span className="av">{(c.brand_name ?? "?").slice(0, 1)}</span>
                    <div>
                      <div className="tt">
                        <Link href={`/brand/${c.id}`} className="hover:underline">{c.brand_name}</Link>
                      </div>
                      <div className="ss">
                        <StateBadge state={c.state as State} />
                      </div>
                    </div>
                    <div className="rt">
                      <span className="pill chip-red">위험</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 에이전트 실행 로그 (정적 안내) */}
          <div className="card">
            <div className="hd"><b>에이전트 실행 로그</b></div>
            <div className="bd" style={{ fontSize: 12 }}>
              <div className="row">
                <span className="ico i-grn">①</span>
                <div><div className="tt">일일 점검 · 09:00</div><div className="ss">상태·게이트 위반 감시</div></div>
              </div>
              <div className="row">
                <span className="ico i-grn">②</span>
                <div><div className="tt">서류 리마인더 · 14:00</div><div className="ss">무응답 브랜드 초안 생성</div></div>
              </div>
              <div className="row">
                <span className="ico i-grn">③</span>
                <div><div className="tt">결제 감시 · 10:00</div><div className="ss">연체·회차 도래 탐지</div></div>
              </div>
              <div className="row">
                <span className="ico i-grn">④</span>
                <div><div className="tt">주간 자가학습 · 월 09:00</div><div className="ss">이 리포트</div></div>
              </div>
              <div className="row">
                <span className="ico i-grn">⑤</span>
                <div><div className="tt">사전분석 · 상시 + 11:00</div><div className="ss">리드 브리프 생성</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
