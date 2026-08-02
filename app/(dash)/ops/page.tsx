import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { opsDashboard, monthFirst, suggestCreators } from "@/lib/operations";
import { PLAN_LABELS, type Plan } from "@/lib/types";

export const dynamic = "force-dynamic";

// 사이클 상태 한글 라벨 (0009_operations: active|closed|paused)
const CYCLE_STATUS_LABELS: Record<string, string> = {
  active: "진행중",
  closed: "마감",
  paused: "일시중지",
};
// 상태 → cellchip 색토큰
const CYCLE_STATUS_CHIP: Record<string, string> = {
  active: "cc-ing",
  closed: "cc-ok",
  paused: "cc-warn",
};

// 이행률 색토큰 (색상표 --danger/--warn/--ok)
function rateColor(rate: number): string {
  return rate < 50 ? "var(--danger)" : rate < 80 ? "var(--warn)" : "var(--ok)";
}

// 운영 사이클 대시보드 (15 §6) — 프로토타입 s-ops 레이아웃.
export default async function OpsPage() {
  const month = monthFirst();
  const rows = await opsDashboard(month).catch(() => []);
  // 시딩 추천은 creators(읽기전용) 미연동 시 [] 반환 → 자연스러운 빈 상태.
  const creators = await suggestCreators("", "US", 5).catch(() => []);

  // 집계(실데이터에서 파생 — 하드코딩 금지)
  const total = rows.reduce((s, r) => s + (r.items_total ?? 0), 0);
  const done = rows.reduce((s, r) => s + (r.items_done ?? 0), 0);
  const active = rows.filter((r) => r.status === "active").length;
  const closed = rows.filter((r) => r.status === "closed").length;
  const paused = rows.filter((r) => r.status === "paused").length;
  const avgRate = rows.length ? Math.round(rows.reduce((s, r) => s + r.rate, 0) / rows.length) : 0;
  const behind = rows.filter((r) => r.rate < 50);

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="운영 사이클"
        desc={`${month.slice(0, 7)} · 운영중 브랜드 사이클 단위 작업(시딩·라이브·리포트)이 워크아이템으로 자동 생성`}
      />

      {/* KPI 타일 4종 — 사이클 결과에서 파생 */}
      <div className="grid g4 gap-3.5" style={{ marginBottom: 14 }}>
        <div className="tile">
          <div className="k">이번 달 사이클</div>
          <div className="v">{rows.length}<small>개</small></div>
          <div className="d">진행중 {active} · 마감 {closed}{paused ? ` · 일시중지 ${paused}` : ""}</div>
        </div>
        <div className="tile">
          <div className="k">워크아이템</div>
          <div className="v">{total}</div>
          <div className="d">완료 {done} · 남음 {Math.max(0, total - done)}</div>
        </div>
        <div className="tile">
          <div className="k">평균 이행률</div>
          <div className="v" style={{ color: rows.length ? rateColor(avgRate) : undefined }}>{avgRate}<small>%</small></div>
          <div className="d">{month.slice(0, 7)} 기준</div>
        </div>
        <div className={behind.length ? "tile alert" : "tile"}>
          <div className="k">이행 지연 (&lt;50%)</div>
          <div className="v">{behind.length}</div>
          <div className={behind.length ? "d dn" : "d"}>{behind.length ? "월중 점검 필요" : "지연 없음"}</div>
        </div>
      </div>

      <div className="grid g2 gap-3.5">
        {/* 브랜드별 사이클 보드 */}
        <div className="card">
          <div className="hd"><b>브랜드별 사이클 보드</b></div>
          {rows.length === 0 ? (
            <div className="bd text-sm" style={{ color: "var(--ink3)" }}>
              이번 달 사이클이 없습니다. 매월 1일 <code>/api/cron/cycle-open</code> 이 운영중(live_*) 브랜드에 자동 발행합니다.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="t">
                <thead>
                  <tr>
                    <th>브랜드</th>
                    <th>플랜</th>
                    <th>이행</th>
                    <th>이행률</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const rate = Math.min(100, r.rate);
                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 700 }}>
                          <Link href={`/brand/${r.brand_id}`}>{r.brand_name}</Link>
                        </td>
                        <td>{PLAN_LABELS[r.plan as Plan] ?? r.plan}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{r.items_done}/{r.items_total}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div className="pr" style={{ width: 96 }}>
                              <i style={{ width: `${rate}%`, background: rateColor(r.rate) }} />
                            </div>
                            <span style={{ color: rateColor(r.rate), fontWeight: 700 }}>{r.rate}%</span>
                          </div>
                        </td>
                        <td>
                          <span className={`cellchip ${CYCLE_STATUS_CHIP[r.status] ?? "cc-no"}`}>
                            {CYCLE_STATUS_LABELS[r.status] ?? r.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 우측 사이드: 시딩 추천 + 이행 점검 */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="hd"><b>크리에이터 시딩 추천</b><span className="chip" style={{ fontSize: 10 }}>크롤러 데이터 기반</span></div>
            <div className="bd" style={{ fontSize: 12 }}>
              {creators.length === 0 ? (
                <div style={{ color: "var(--ink3)" }}>연동된 크리에이터 데이터가 없습니다.</div>
              ) : (
                creators.map((c) => (
                  <div className="row" key={c.handle}>
                    <span className="av">{c.handle.replace(/^@/, "").charAt(0).toUpperCase() || "?"}</span>
                    <div>
                      <div className="tt">{c.handle}</div>
                      <div className="ss">적합도 {c.score} · {c.reason}</div>
                    </div>
                    <div className="rt">
                      <span className="cellchip cc-ing">
                        {c.avg_views != null ? `${c.avg_views.toLocaleString()} 조회` : "조회 —"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <div className="hd"><b>이행 점검 필요</b>{behind.length ? <span className="chip red">{behind.length}</span> : null}</div>
            <div className="bd" style={{ fontSize: 12 }}>
              {behind.length === 0 ? (
                <div style={{ color: "var(--ink3)" }}>이행률 50% 미만 브랜드가 없습니다.</div>
              ) : (
                behind.map((r) => (
                  <div className="row" key={r.id}>
                    <span className="ico i-red">⚠️</span>
                    <div>
                      <div className="tt">
                        <Link href={`/brand/${r.brand_id}`}>{r.brand_name}</Link>
                      </div>
                      <div className="ss">이행률 {r.rate}% · {r.items_done}/{r.items_total} · {CYCLE_STATUS_LABELS[r.status] ?? r.status}</div>
                    </div>
                    <div className="rt">
                      <span style={{ color: rateColor(r.rate), fontWeight: 700 }}>{r.rate}%</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
