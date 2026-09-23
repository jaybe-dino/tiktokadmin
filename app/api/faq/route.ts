import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// 공개 FAQ JSON — 승인된 qna_entries 만 노출(공개 /faq 페이지와 동일 소스·조건).
// glovek.space 등 외부 사이트가 관리자 승인 답변을 그대로 반영하도록 서버-투-서버로 소비한다.
// 미승인·내부메모·고객/메일/인증정보는 노출하지 않는다(approved=true, 공개 컬럼만 SELECT).
export async function GET() {
  try {
    const rows = await query<{ question: string; answer: string; category: string | null; usage_count: number }>(
      `SELECT question, answer, category, usage_count
         FROM qna_entries
        WHERE approved = true AND answer IS NOT NULL AND btrim(answer) <> ''
        ORDER BY category NULLS LAST, usage_count DESC, created_at DESC
        LIMIT 500`,
    );
    return NextResponse.json(
      { ok: true, count: rows.length, updatedAt: new Date().toISOString(), entries: rows },
      { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (e) {
    // 쿼리 실패는 빈 결과로 위장하지 않고 에러로 반환(소비자가 '로드 실패'와 '빈 목록'을 구분).
    return NextResponse.json(
      { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) },
      { status: 502, headers: { "access-control-allow-origin": "*" } },
    );
  }
}
