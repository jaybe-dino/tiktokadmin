import Link from "next/link";
import AlertActions from "@/components/AlertActions";
import ScreenHeader from "@/components/ScreenHeader";
import { query } from "@/lib/db";
import { humanElapsed } from "@/lib/time";

export const dynamic = "force-dynamic";

// 알림 라우팅 설정 — 무엇을 · 어디로 · 어떻게 묶는지. 채널·묶음 규칙은 설정(환경변수/워커)에서 관리.
// kinds: 최근 24h 발송량 집계에 사용할 alerts.kind 값 (없으면 0). tierMin: 티어 기준 집계.
const ROUTING: {
  title: string;
  sub?: string;
  target: string;
  bundle: string;
  kinds?: string[];
  tierMin?: number;
}[] = [
  { title: "신규 유입 카드", sub: "리드 등록 + AI 브리프 + [담당 수락]", target: "#glovek-유입알림", bundle: "건별 즉시", kinds: ["intake", "new_lead"] },
  { title: "회의록·팔로업 승인", sub: "회의록 요약 + 게이트 체크리스트 + [승인·발송]", target: "담당 DM + #glovek-영업", bundle: "건별 즉시", kinds: ["followup", "meeting"] },
  { title: "SLA·방치 알림 (T0·T1)", sub: "조치 버튼 포함", target: "담당 DM", bundle: "개인별 다이제스트 1건 (스팸 방지)", kinds: ["sla_breach", "no_reply", "stale"] },
  { title: "에스컬레이션 T2+", sub: "파트장 개입 필요", target: "#glovek-파트장 (+T3는 대표 DM·메일)", bundle: "건별 즉시", tierMin: 2 },
  { title: "결제·정산 카드", sub: "결제 확인·연체·수기 회차·정산 확정", target: "#glovek-정산알림", bundle: "건별 + 10시 감시표", kinds: ["pay", "settle", "overdue"] },
  { title: "결재 요청", sub: "드랍·후퇴·할인 초과·정산 확정 [승인/반려]", target: "결재자 DM", bundle: "건별 즉시 · 48h 미결 상위 재알림", kinds: ["approval"] },
  { title: "일일 운영 요약", sub: "에이전트① 파트별 지적 목록", target: "#glovek-데일리 (+대표 이메일)", bundle: "매일 09:00 1건", kinds: ["cycle_behind"] },
  { title: "주간 자가학습 리포트", target: "#glovek-데일리 + 대표", bundle: "매주 월 09:00" },
  { title: "서류 리마인더 초안 카드", sub: "[승인·발송] 버튼", target: "#glovek-온보딩", bundle: "매일 14:00 묶음", kinds: ["cert_risk", "doc_reminder"] },
  { title: "시스템 오류·파이프라인", sub: "ingest 실패·웹훅 미수신", target: "#glovek-시스템", bundle: "건별 즉시", kinds: ["inbound_fwd", "system"] },
];

// 슬래시 명령 (인바운드) — 봇이 제공하는 명령 목록(기능 설명).
const SLASH: { icon: string; iconCls: string; cmd: string; desc: string }[] = [
  { icon: "/", iconCls: "i-blu", cmd: "/brand {이름}", desc: "브랜드 카드 요약 + 딥링크" },
  { icon: "/", iconCls: "i-blu", cmd: "/sla", desc: "내 SLA 알림 목록" },
  { icon: "/", iconCls: "i-blu", cmd: "/today", desc: "오늘 미팅·할 일 요약" },
  { icon: "💬", iconCls: "i-pur", cmd: "/ask (AI 질의)", desc: 'MCP 경유 — "서류 밀린 브랜드?" 자연어 질의' },
];

type AlertRow = {
  id: string;
  brand_id: string | null;
  brand_name: string | null;
  kind: string;
  tier: number;
  message: string;
  created_at: string;
  resolved_at: string | null;
  snoozed_until: string | null;
};

function tierChip(tier: number): { cls: string; label: string } {
  if (tier >= 3) return { cls: "chip-red", label: "T3" };
  if (tier === 2) return { cls: "chip-amb", label: "T2" };
  return { cls: "chip-grn", label: "T" + tier };
}

export default async function SlackPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const kindFilter = sp.kind ?? "";
  const statusFilter = sp.status ?? "";
  const filtered = Boolean(kindFilter || statusFilter);

  // 로그 필터 — kind / 처리상태 (실제 SQL WHERE 로 반영, 파라미터 바인딩).
  const where: string[] = [];
  const params: unknown[] = [];
  if (kindFilter) {
    params.push(kindFilter);
    where.push(`a.kind = $${params.length}`);
  }
  if (statusFilter === "pending") where.push("a.resolved_at IS NULL");
  else if (statusFilter === "resolved") where.push("a.resolved_at IS NOT NULL");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // 최근 alerts 발송 로그 — 테이블 없어도 방어.
  const rows = await query<AlertRow>(
    `SELECT a.id, a.brand_id, b.brand_name, a.kind, a.tier, a.message, a.created_at, a.resolved_at, a.snoozed_until
       FROM alerts a
       LEFT JOIN brands b ON b.id = a.brand_id
       ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT 30`,
    params,
  ).catch(() => [] as AlertRow[]);

  // 필터 select 용 실제 종류 목록 (전체 alerts 기준, 필터 무관).
  const kindRows = await query<{ kind: string }>(
    `SELECT DISTINCT kind FROM alerts ORDER BY kind`,
  ).catch(() => [] as { kind: string }[]);
  const kindOptions = kindRows.map((k) => k.kind);

  // 최근 24h 종류별 발송량 — 라우팅 표의 실제 24h 컬럼용.
  const counts = await query<{ kind: string; tier: number; n: string }>(
    `SELECT kind, tier, count(*)::text n
       FROM alerts
      WHERE created_at > now() - interval '24 hours'
      GROUP BY kind, tier`
  ).catch(() => [] as { kind: string; tier: number; n: string }[]);

  const byKind = new Map<string, number>();
  let tier2Plus = 0;
  for (const c of counts) {
    byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + Number(c.n));
    if (c.tier >= 2) tier2Plus += Number(c.n);
  }
  function count24(r: (typeof ROUTING)[number]): number | null {
    if (r.tierMin != null) return tier2Plus;
    if (!r.kinds) return null;
    return r.kinds.reduce((s, k) => s + (byKind.get(k) ?? 0), 0);
  }

  const preview = rows.find((r) => r.brand_name) ?? null;

  return (
    <div>
      <ScreenHeader
        title="Slack 알림 관리 — 양방향 연동"
        desc="알림(아웃) 라우팅 + 버튼·슬래시(인) 현황 · 모든 버튼 액션은 게이트 검증을 거쳐 DB에 반영됩니다."
      />

      <div className="grid g31">
        {/* ── 왼쪽: 라우팅 + 로그 ── */}
        <div style={{ display: "grid", gap: 14 }}>
          <div className="card">
            <div className="card-hd">
              <b>알림 라우팅 — 무엇을 · 어디로 · 어떻게</b>
              <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: "auto" }}>
                행을 클릭하면 해당 종류의 로그로 필터 · 채널·묶음 규칙은 워커·환경변수에서 관리
              </span>
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th>알림 종류</th>
                  <th>채널 / 대상</th>
                  <th>묶음 규칙</th>
                  <th>24h</th>
                  <th>ON</th>
                </tr>
              </thead>
              <tbody>
                {ROUTING.map((r) => {
                  const n = count24(r);
                  return (
                    <tr key={r.title}>
                      <td>
                        {r.kinds && r.kinds.length ? (
                          <Link
                            href={`/slack?kind=${encodeURIComponent(r.kinds[0])}`}
                            style={{ color: "inherit" }}
                          >
                            <b>{r.title}</b>
                          </Link>
                        ) : (
                          <b>{r.title}</b>
                        )}
                        {r.sub ? <span className="sub">{r.sub}</span> : null}
                      </td>
                      <td>{r.target}</td>
                      <td>{r.bundle}</td>
                      <td>{n == null ? "—" : n}</td>
                      <td>
                        <span className="tgl on" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "8px 16px" }} className="note">
              중복 게시 방지: 같은 알림은 기존 카드를 갱신(✅ 처리됨)하고 새로 쏘지 않습니다 ·
              해소되면 카드가 자동으로 완료 표시로 바뀝니다
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <b>
                최근 발송·처리 로그 {rows.length}건{filtered ? " · 필터 적용" : ""}
              </b>
            </div>
            <form method="GET" className="bar" style={{ padding: "8px 16px 0" }}>
              <select name="kind" defaultValue={kindFilter} style={{ width: 170 }}>
                <option value="">종류 전체</option>
                {kindOptions.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <select name="status" defaultValue={statusFilter} style={{ width: 130 }}>
                <option value="">상태 전체</option>
                <option value="pending">미처리</option>
                <option value="resolved">처리됨</option>
              </select>
              <button className="btn sm pri" type="submit">
                필터
              </button>
              {filtered && (
                <Link href="/slack" className="btn sm">
                  초기화
                </Link>
              )}
            </form>
            <div className="bd" style={{ paddingTop: 6, fontSize: 12 }}>
              {rows.length === 0 ? (
                <p style={{ color: "var(--ink3)" }}>
                  {filtered
                    ? "조건에 맞는 알림 로그가 없습니다."
                    : "발송된 알림 로그가 없습니다. Slack 연동(SLACK_* 환경변수)이 설정되면 이곳에 발송·처리 기록이 표시됩니다."}
                </p>
              ) : (
                rows.slice(0, filtered ? 30 : 8).map((a) => {
                  const done = Boolean(a.resolved_at);
                  const t = tierChip(a.tier);
                  return (
                    <div className="row" key={a.id}>
                      <span className={`ico ${done ? "i-grn" : "i-amb"}`}>
                        {done ? "✅" : "🕐"}
                      </span>
                      <div>
                        <div className="tt">
                          {a.brand_id ? (
                            <Link href={`/brand/${a.brand_id}`}>
                              {a.brand_name ?? a.brand_id}
                            </Link>
                          ) : (
                            "—"
                          )}{" "}
                          · {a.message}
                        </div>
                        <div className="ss">
                          {a.kind} · 발송 {humanElapsed(a.created_at)}
                          {done ? " · 처리됨" : " · 미처리"}
                        </div>
                      </div>
                      <div
                        className="rt"
                        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}
                      >
                        <span className={`chip ${t.cls}`}>{t.label}</span>
                        {!done &&
                          (a.snoozed_until ? (
                            <span className="pill" style={{ color: "var(--ink3)" }}>
                              스누즈됨
                            </span>
                          ) : (
                            <AlertActions alertId={a.id} />
                          ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── 오른쪽: 인바운드 + 미리보기 + 개인설정 ── */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="card-hd">
              <b>슬래시 명령 (인바운드)</b>
            </div>
            <div className="bd" style={{ fontSize: 12 }}>
              {SLASH.map((s) => (
                <div className="row" key={s.cmd}>
                  <span className={`ico ${s.iconCls}`}>{s.icon}</span>
                  <div>
                    <div className="tt">{s.cmd}</div>
                    <div className="ss">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <b>Slack 카드 미리보기</b>
            </div>
            <div className="bd">
              {preview ? (
                <>
                  <div className="slk">
                    <b style={{ color: "#611f69" }}>#glovek-유입알림</b>{" "}
                    <span style={{ color: "var(--ink3)", fontSize: 11 }}>
                      {humanElapsed(preview.created_at)}
                    </span>
                    <br />
                    <b>{preview.brand_name ?? preview.brand_id}</b>{" "}
                    <span style={{ color: "var(--ink3)", fontSize: 11.5 }}>· {preview.kind}</span>
                    <br />
                    <span style={{ color: "var(--ink3)", fontSize: 11.5 }}>{preview.message}</span>
                    <div
                      style={{
                        borderTop: "1px solid var(--line)",
                        margin: "6px 0",
                        paddingTop: 6,
                        fontSize: 11.5,
                      }}
                    >
                      ▶ 카드 열기 → 어드민에서 조치
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {preview.brand_id ? (
                        <Link className="btn sm pri" href={`/brand/${preview.brand_id}`}>
                          카드 열기
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <div className="note" style={{ marginTop: 10 }}>
                    버튼 클릭 = 어드민과 동일한 ops API 호출 — 게이트·권한 검증도 동일하게 적용
                  </div>
                </>
              ) : (
                <p style={{ color: "var(--ink3)", fontSize: 12 }}>
                  미리보기로 표시할 최근 알림 카드가 없습니다. 브랜드 연결 알림이 발생하면
                  실제 Slack 카드 형태로 이곳에 미리보기가 표시됩니다.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <b>개인 알림 설정</b>
            </div>
            <div className="bd" style={{ fontSize: 12, lineHeight: 1.7 }}>
              방해금지(기본 22–08시, T3는 예외) · 다이제스트 시각 · DM/채널 선호는{" "}
              <b>설정·조직 → 계정 상세</b>에서 개인별로 관리합니다. 부재 설정 시 T0/T1이
              위임자에게 전달됩니다.
              <div style={{ marginTop: 8 }}>
                <Link className="btn sm" href="/settings">
                  계정 설정으로 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
