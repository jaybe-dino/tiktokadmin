// 라우트 전환 시 즉시 표시되는 스켈레톤 — 서버 렌더(DB 조회) 대기 동안 빈 화면 대신
//   골격을 먼저 보여줘 체감 속도를 높인다(모든 (dash) 페이지 공통).
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="불러오는 중">
      <div style={{ height: 22, width: 220, background: "var(--line)", borderRadius: 6, marginBottom: 8 }} />
      <div style={{ height: 13, width: 340, background: "var(--line)", borderRadius: 6, marginBottom: 18, opacity: 0.6 }} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="tile"><div style={{ height: 40 }} /></div>
        ))}
      </div>
      <div className="card"><div style={{ height: 260 }} /></div>
    </div>
  );
}
