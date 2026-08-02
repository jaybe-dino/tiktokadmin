import { Fragment } from "react";
import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { query } from "@/lib/db";
import { humanElapsed } from "@/lib/time";

export const dynamic = "force-dynamic";

// 채널 매핑 안내 — 알림 종류별 라우팅 채널(.kv). 실제 라우팅 로직은 워커/설정에서 관리.
const CHANNEL_MAP: { kind: string; channel: string; env: string }[] = [
  { kind: "유입 (신규 리드 카드)", channel: "#glovek-유입알림", env: "SLACK_CH_INTAKE" },
  { kind: "온보딩 (서류·인증 리마인더)", channel: "#glovek-온보딩", env: "SLACK_CH_ONBOARD" },
  { kind: "광고·캠페인", channel: "#glovek-광고", env: "SLACK_CH_ADS" },
  { kind: "정산 (결제·연체·확정)", channel: "#glovek-정산알림", env: "SLACK_CH_SETTLE" },
  { kind: "리드/영업 (팔로업·제안)", channel: "#glovek-영업", env: "SLACK_CH_SALES" },
  { kind: "데일리 (일일·주간 요약)", channel: "#glovek-데일리", env: "SLACK_CH_DAILY" },
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
};

function tierChip(tier: number): { cls: string; label: string } {
  if (tier >= 3) return { cls: "chip-red", label: "T3" };
  if (tier === 2) return { cls: "chip-amb", label: "T2" };
  return { cls: "chip-grn", label: "T" + tier };
}

export default async function SlackPage() {
  // 최근 alerts 발송 로그 — 테이블 없어도 방어.
  const rows = (await query<AlertRow>(
    `SELECT a.id, a.brand_id, b.brand_name, a.kind, a.tier, a.message, a.created_at, a.resolved_at
       FROM alerts a
       LEFT JOIN brands b ON b.id = a.brand_id
      ORDER BY a.created_at DESC
      LIMIT 30`
  ).catch(() => [] as AlertRow[]));

  return (
    <div>
      <ScreenHeader
        title="Slack 알림 관리"
        desc="알림 종류별 채널 라우팅 + 최근 발송 로그 · 모든 버튼 액션은 게이트 검증을 거쳐 DB에 반영됩니다."
      />

      <div className="grid g2">
        <div className="card">
          <div className="card-hd">
            <b>채널 매핑 — 무엇을 · 어디로</b>
          </div>
          <div className="card-bd">
            <dl className="kv">
              {CHANNEL_MAP.map((c) => (
                <Fragment key={c.env}>
                  <dt>{c.kind}</dt>
                  <dd>
                    {c.channel}{" "}
                    <span style={{ color: "var(--ink3)", fontSize: 11 }}>
                      ({c.env})
                    </span>
                  </dd>
                </Fragment>
              ))}
            </dl>
            <div className="note" style={{ marginTop: 12 }}>
              채널·봇 토큰은 환경변수 <b>SLACK_*</b> 로 설정합니다: <b>SLACK_BOT_TOKEN</b> ·{" "}
              <b>SLACK_SIGNING_SECRET</b> · 각 채널 <b>SLACK_CH_*</b>. 미설정 시 해당 알림은
              전송되지 않고 건너뜁니다. 중복 게시 방지: 같은 알림은 기존 카드를 갱신하고 새로
              쏘지 않으며, 해소되면 완료 표시로 바뀝니다.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <b>개인 알림 설정</b>
          </div>
          <div className="card-bd" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            방해금지(기본 22–08시, T3는 예외) · 다이제스트 시각 · DM/채널 선호는{" "}
            <b>설정·조직 → 계정 상세</b>에서 개인별로 관리합니다. 부재 설정 시 T0/T1이
            위임자에게 전달됩니다.
            <div style={{ marginTop: 10 }}>
              <Link className="btn btn-sm" href="/settings">
                계정 설정으로 →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-hd">
          <b>최근 발송·처리 로그 {rows.length}건</b>
        </div>
        {rows.length === 0 ? (
          <div className="card-bd">
            <p style={{ color: "var(--ink3)" }}>
              발송된 알림 로그가 없습니다. Slack 연동(SLACK_* 환경변수)이 설정되면 이곳에
              발송·처리 기록이 표시됩니다.
            </p>
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>티어</th>
                <th>종류</th>
                <th>브랜드</th>
                <th>메시지</th>
                <th>상태</th>
                <th>발송</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const t = tierChip(a.tier);
                return (
                  <tr key={a.id}>
                    <td>
                      <span className={`chip ${t.cls}`}>{t.label}</span>
                    </td>
                    <td>{a.kind}</td>
                    <td>
                      {a.brand_id ? (
                        <Link href={`/brand/${a.brand_id}`}>
                          {a.brand_name ?? a.brand_id}
                        </Link>
                      ) : (
                        <span style={{ color: "var(--ink3)" }}>—</span>
                      )}
                    </td>
                    <td>{a.message}</td>
                    <td>
                      {a.resolved_at ? (
                        <span className="chip chip-grn">✅ 처리됨</span>
                      ) : (
                        <span className="chip chip-amb">🕐 미처리</span>
                      )}
                    </td>
                    <td style={{ color: "var(--ink3)", whiteSpace: "nowrap" }}>
                      {humanElapsed(a.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
