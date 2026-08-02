import Link from "next/link";
import AlertActions from "@/components/AlertActions";
import ScreenHeader from "@/components/ScreenHeader";
import { monitorData } from "@/lib/repo/queries";
import { humanElapsed } from "@/lib/time";

export const dynamic = "force-dynamic";

function slaClass(tier: number): string {
  return tier >= 3 ? "t3" : tier >= 2 ? "t2" : tier >= 1 ? "t1" : "ok";
}

export default async function MonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const { alerts: allAlerts, gateViolations } = await monitorData().catch(() => ({
    alerts: [] as Awaited<ReturnType<typeof monitorData>>["alerts"],
    gateViolations: [] as Awaited<ReturnType<typeof monitorData>>["gateViolations"],
  }));

  // KPI 타일은 전체 기준(필터 무관), 아래 표만 필터 적용.
  const t3 = allAlerts.filter((a) => a.tier >= 3).length;
  const t2 = allAlerts.filter((a) => a.tier === 2).length;
  const t1 = allAlerts.filter((a) => a.tier === 1).length;
  const t0 = allAlerts.filter((a) => a.tier <= 0).length;
  const t2plus = allAlerts.filter((a) => a.tier >= 2).length;

  const kinds = Array.from(new Set(allAlerts.map((a) => a.kind))).sort();
  const tierFilter = sp.tier ?? "";
  const kindFilter = sp.kind ?? "";
  const tierMatch = (t: number): boolean => {
    switch (tierFilter) {
      case "3": return t >= 3;
      case "2": return t === 2;
      case "1": return t === 1;
      case "0": return t <= 0;
      case "2plus": return t >= 2;
      default: return true;
    }
  };
  const alerts = allAlerts.filter(
    (a) => tierMatch(a.tier) && (!kindFilter || a.kind === kindFilter),
  );
  const filtered = Boolean(tierFilter || kindFilter);

  return (
    <div>
      <ScreenHeader
        title="SLA 모니터"
        desc="매시간 자동 검사 · KST 영업일 기준 · 해소되면 자동으로 사라집니다."
      />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="tile">
          <div className="k">활성 알림</div>
          <div className="v">{alerts.length}</div>
          <div className="d">T1 {t1} · T2 {t2} · T3 {t3}</div>
        </div>
        <div className="tile">
          <div className="k">T2 이상 (파트장)</div>
          <div className="v" style={{ color: "var(--danger)" }}>{t2plus}</div>
          <div className="d">파트장 에스컬레이션 대상</div>
        </div>
        <div className="tile">
          <div className="k">게이트 위반 (14일)</div>
          <div className="v">{gateViolations.length}</div>
          <div className="d">stage_history 기준</div>
        </div>
        <div className="tile">
          <div className="k">T1 알림</div>
          <div className="v">{t1}</div>
          <div className="d">매일 담당 DM 반복</div>
        </div>
      </div>

      <form method="GET" className="bar">
        <select name="tier" defaultValue={tierFilter} style={{ width: 150 }}>
          <option value="">티어 전체</option>
          <option value="2plus">T2 이상</option>
          <option value="3">T3</option>
          <option value="2">T2</option>
          <option value="1">T1</option>
          <option value="0">T0</option>
        </select>
        <select name="kind" defaultValue={kindFilter} style={{ width: 170 }}>
          <option value="">종류 전체</option>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" type="submit">필터</button>
        {filtered && <Link href="/monitor" className="btn btn-sm">초기화</Link>}
      </form>

      <div className="grid g31">
        <div className="card">
          <div className="hd">
            <b>활성 알림 {alerts.length}건{filtered && ` / 전체 ${allAlerts.length}`}</b>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th>티어</th>
                <th>브랜드</th>
                <th>종류</th>
                <th>내용</th>
                <th>경과</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alerts.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--ink3)" }}>
                    {filtered ? "조건에 맞는 알림이 없습니다" : "활성 알림이 없습니다 🎉"}
                  </td>
                </tr>
              )}
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td><span className={`sla ${slaClass(a.tier)}`}>T{a.tier}</span></td>
                  <td>
                    <Link href={`/brand/${a.brand_id}`}><b>{a.brand_name}</b></Link>
                  </td>
                  <td>{a.kind}</td>
                  <td style={{ fontSize: 12 }}>{a.message}</td>
                  <td style={{ color: "var(--ink3)", whiteSpace: "nowrap" }}>{humanElapsed(a.created_at)}</td>
                  <td>
                    {a.snoozed_until ? (
                      <span className="pill" style={{ color: "var(--ink3)" }}>스누즈됨</span>
                    ) : (
                      <AlertActions alertId={a.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="hd"><b>에스컬레이션 사다리</b></div>
            <div className="bd" style={{ fontSize: 12 }}>
              <div className="row">
                <span className="sla ok" style={{ alignSelf: "center" }}>T0</span>
                <div>
                  <div className="tt">발생 당일 · {t0}건</div>
                  <div className="ss">담당 DM + 조치 버튼</div>
                </div>
              </div>
              <div className="row">
                <span className="sla t1" style={{ alignSelf: "center" }}>T1</span>
                <div>
                  <div className="tt">매일 반복 · {t1}건</div>
                  <div className="ss">해소까지 담당 DM 재발송</div>
                </div>
              </div>
              <div className="row">
                <span className="sla t2" style={{ alignSelf: "center" }}>T2</span>
                <div>
                  <div className="tt">+2일 · {t2}건</div>
                  <div className="ss">파트장 채널 + 메일</div>
                </div>
              </div>
              <div className="row">
                <span className="sla t3" style={{ alignSelf: "center" }}>T3</span>
                <div>
                  <div className="tt">+5일 · {t3}건</div>
                  <div className="ss">대표 적색 목록</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="hd"><b>게이트 위반 로그 (14일)</b></div>
            {gateViolations.length === 0 ? (
              <div className="note">최근 14일간 게이트 위반이 없습니다</div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th>브랜드</th>
                    <th>사유</th>
                    <th>처리자</th>
                    <th>시각</th>
                  </tr>
                </thead>
                <tbody>
                  {gateViolations.map((g, i) => (
                    <tr key={i}>
                      <td><b>{g.brand_name}</b></td>
                      <td style={{ fontSize: 12 }}>{g.reason}</td>
                      <td style={{ color: "var(--ink3)" }}>{g.actor}</td>
                      <td style={{ color: "var(--ink3)", whiteSpace: "nowrap" }}>
                        {g.at.slice(5, 16).replace("T", " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
