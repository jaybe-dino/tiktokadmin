import ScreenHeader from "@/components/ScreenHeader";
import { allQna } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

export default async function QnaPage() {
  const rows = (await allQna().catch(() => [])) as Record<string, unknown>[];
  return (
    <div className="max-w-3xl">
      <ScreenHeader title="QnA 지식베이스" desc={`총 ${rows.length}건 · 반복 질문 자산화 (메일·미팅 소스)`} />
      <div className="space-y-2">
        {rows.length === 0 && <div className="card p-6 text-sm" style={{ color: "var(--ink3)" }}>등록된 QnA가 없습니다.</div>}
        {rows.map((q) => (
          <details key={q.id as string} className="card p-4">
            <summary className="cursor-pointer flex items-center gap-2">
              <span className="pill chip">{(q.category as string) || "일반"}</span>
              <span className="font-semibold">{q.question as string}</span>
              <span className="ml-auto text-[11px]" style={{ color: "var(--ink3)" }}>
                {q.approved ? "승인됨" : "후보"} · {String(q.usage_count ?? 0)}회 사용
              </span>
            </summary>
            <p className="text-sm mt-3" style={{ color: "var(--ink2)" }}>{q.answer as string}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
