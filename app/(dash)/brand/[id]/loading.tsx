// 브랜드360 전환 시 즉시 스켈레톤(가장 무거운 페이지 — 다중 조회 대기 동안 빈 화면 방지).
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="불러오는 중">
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ height: 44, width: "60%", background: "var(--line)", borderRadius: 8, marginBottom: 12 }} />
        <div style={{ height: 24, background: "var(--line)", borderRadius: 8, opacity: 0.6 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2.1fr 1fr", gap: 14 }}>
        <div className="card" style={{ height: 320 }} />
        <div className="card" style={{ height: 320 }} />
      </div>
    </div>
  );
}
