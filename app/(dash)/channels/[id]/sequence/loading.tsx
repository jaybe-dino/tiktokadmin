// 목록보기 로딩 — 빈 목록·조회 실패와 구분되도록 "불러오는 중"을 명시한다.
export default function Loading() {
  return (
    <div className="max-w-6xl">
      <div className="card" style={{ padding: 20, fontSize: 13, color: "var(--ink3)" }}>
        연속 안내 목록을 불러오는 중입니다…
      </div>
    </div>
  );
}
