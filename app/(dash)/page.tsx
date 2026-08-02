import Link from "next/link";
import Board from "@/components/Board";
import { boardCards } from "@/lib/repo/queries";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  let cards;
  try {
    cards = await boardCards();
  } catch (e) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-lg font-bold text-bad mb-2">보드 로드 오류 (진단)</h1>
        <pre className="text-xs bg-red-50 p-3 rounded overflow-auto whitespace-pre-wrap">{(e as Error).message}</pre>
        <p className="text-sm text-muted mt-2">이 메시지를 복사해 공유해 주세요.</p>
      </div>
    );
  }
  const active = cards.filter((c) => c.state !== "dropped" && c.state !== "churned");
  const dropped = cards.filter((c) => c.state === "dropped" || c.state === "churned");

  return (
    <div>
      {/* 헤더 + 필터 바 (프로토타입 .ph) */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-[19px] font-extrabold">파이프라인 보드</h1>
          <p className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>
            카드를 옮기면 게이트가 검증됩니다 — 조건 미충족이면 이동이 거부되고 부족 항목이 표시돼요. (활성 {active.length} · 종료 {dropped.length})
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select className="input" style={{ width: "auto" }} defaultValue=""><option value="">전체 파트</option><option>영업</option><option>온보딩</option><option>운영</option></select>
          <select className="input" style={{ width: "auto" }} defaultValue=""><option value="">전체 담당</option><option>내 담당만</option></select>
          <select className="input" style={{ width: "auto" }} defaultValue=""><option value="">등급 전체</option><option>S</option><option>A</option><option>B</option><option>C</option></select>
          <Link href="/import" className="btn btn-primary">+ 브랜드 추가</Link>
        </div>
      </div>
      {active.length === 0 && (
        <div className="card p-6 text-center text-muted mb-4">
          아직 브랜드가 없습니다. <Link href="/import" className="text-pink font-semibold underline">데이터 가져오기</Link>에서
          직접 추가하거나 CSV로 불러오세요. 사이트 연동이 붙으면 자동으로 쌓입니다.
        </div>
      )}
      <Board cards={active} />
      <div className="note" style={{ marginTop: 8 }}>
        💡 <b>카드를 직접 끌어서 옮겨보세요</b> — 놓는 순간 ① 권한 검사(내 담당/파트장인가) → ② 게이트 검사(조건 충족?) 순으로 서버가 판정합니다. 미충족이면 이동이 거부되고 부족 항목+해결 바로가기가 뜹니다.
      </div>
    </div>
  );
}
