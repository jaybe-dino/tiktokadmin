// 행사별 외부 열람 페이지(읽기 전용).
//   · 쿠키의 열람 세션이 "이 링크"에 대한 것일 때만 명단이 보인다 — 링크를 바꿔 끼워
//     다른 행사 명단을 보는 경로가 없다.
//   · 관리자 화면·브랜드 원장으로 가는 링크를 두지 않는다.
//   · 노출 항목은 관리자가 고른 것만, 연락처는 마스킹된 값만 나온다.
import { shareViewFor, readRoster } from "@/lib/seminar-event-share";
import { fmtKstDateTime } from "@/lib/seminar-events-model";
import RosterGate from "./RosterGate";
import RosterLogout from "./RosterLogout";

export const dynamic = "force-dynamic";
// 외부 공유 명단 — 검색엔진 수집·보관을 모두 막는다.
export const metadata = {
  title: "참석자 명단 열람",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default async function RosterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await shareViewFor(token).catch(() => null);
  if (!view) return <RosterGate token={token} />;

  const data = await readRoster(view).catch(() => null);

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <div style={S.head}>
          <div>
            <div style={S.badge}>참석자 명단 · 읽기 전용</div>
            <h1 style={S.h1}>{view.eventTitle}</h1>
            {view.label && <div style={S.sub}>공유 대상: {view.label}</div>}
            {view.expiresAt && <div style={S.sub}>열람 세션 만료: {fmtKstDateTime(view.expiresAt)} (KST)</div>}
          </div>
          <RosterLogout />
        </div>

        {data === null ? (
          <div style={S.note}>명단을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>
        ) : data.headers.length === 0 ? (
          <div style={S.note}>표시할 항목이 설정되지 않았습니다 — 담당자에게 문의해주세요.</div>
        ) : data.rows.length === 0 ? (
          <div style={S.note}>아직 접수된 신청이 없습니다.</div>
        ) : (
          <>
            <div style={S.count}>총 {data.total}건</div>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>#</th>
                    {data.headers.map((h) => <th key={h.key} style={S.th}>{h.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...S.td, color: "#9aa3af" }}>{i + 1}</td>
                      {r.cells.map((c) => <td key={c.key} style={S.td}>{c.value || "—"}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.allowDownload && (
              <a href={`/api/roster/${encodeURIComponent(token)}/export`} style={S.dl}>CSV 내려받기</a>
            )}
          </>
        )}

        <p style={S.foot}>
          개인정보가 포함된 화면입니다 — 화면 공유·캡처·재배포에 주의해주세요.
          연락처는 마스킹되어 표시되며, 내부 메모는 포함되지 않습니다.
        </p>
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f6f7f9", padding: "26px 14px 60px" },
  wrap: { width: "100%", maxWidth: 900, margin: "0 auto" },
  head: { display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 16 },
  badge: { display: "inline-block", fontSize: 10.5, fontWeight: 800, letterSpacing: ".1em", color: "#1d4ed8", background: "#eef4ff", borderRadius: 999, padding: "4px 10px" },
  h1: { fontSize: 20, fontWeight: 800, color: "#111", margin: "10px 0 4px", lineHeight: 1.4 },
  sub: { fontSize: 12, color: "#6b7280", lineHeight: 1.7 },
  note: { background: "#fff", border: "1px solid #e9ecef", borderRadius: 12, padding: "16px 16px", fontSize: 13.5, color: "#374151", lineHeight: 1.75 },
  count: { fontSize: 12, color: "#6b7280", marginBottom: 8 },
  tableWrap: { background: "#fff", border: "1px solid #e9ecef", borderRadius: 12, overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 320 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e9ecef", color: "#6b7280", fontWeight: 700, whiteSpace: "nowrap" },
  td: { padding: "10px 12px", borderBottom: "1px solid #f1f3f5", color: "#111", verticalAlign: "top", wordBreak: "keep-all" },
  dl: { display: "inline-block", marginTop: 12, border: "1px solid #dfe3e8", background: "#fff", color: "#374151", borderRadius: 9, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, textDecoration: "none" },
  foot: { fontSize: 11, color: "#9aa3af", lineHeight: 1.8, marginTop: 18 },
};
