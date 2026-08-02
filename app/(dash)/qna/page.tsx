import ScreenHeader from "@/components/ScreenHeader";
import QnaKnowledgeTable, { type QnaRow } from "@/components/QnaKnowledgeTable";
import QnaCreateButton from "@/components/QnaCreateButton";
import { allQna } from "@/lib/repo/global";

export const dynamic = "force-dynamic";

export default async function QnaPage() {
  const raw = (await allQna().catch(() => [])) as Record<string, unknown>[];
  const rows: QnaRow[] = raw.map((r) => ({
    id: String(r.id),
    question: (r.question as string) ?? "",
    answer: (r.answer as string) ?? "",
    category: (r.category as string) ?? "",
    approved: Boolean(r.approved),
    usage_count: Number(r.usage_count ?? 0),
  }));

  const pending = rows.filter((r) => !r.approved);
  const categories = Array.from(
    new Set(rows.map((r) => (r.category || "").trim()).filter(Boolean)),
  );

  return (
    <div>
      <div className="ph">
        <div>
          <ScreenHeader
            title="QnA 지식베이스"
            desc="메일·미팅에서 나온 질문이 자산화됩니다 — 재사용될수록 답장이 빨라져요."
          />
        </div>
        <div className="bar" style={{ margin: 0 }}>
          <QnaCreateButton categories={categories} />
        </div>
      </div>

      <div className="grid g31">
        <QnaKnowledgeTable rows={rows} />

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="hd">
              <b>승인 대기</b>
              <span className="chip amb">{pending.length}</span>
            </div>
            <div className="bd" style={{ fontSize: 12 }}>
              {pending.length === 0 && (
                <div style={{ color: "var(--ink3)" }}>승인 대기 중인 질문이 없습니다.</div>
              )}
              {pending.slice(0, 6).map((p) => (
                <div className="row" key={p.id}>
                  <span className="ico i-amb">📝</span>
                  <div>
                    <div className="tt">
                      #{String(p.id).slice(0, 8)} {p.question}
                    </div>
                    <div className="ss">
                      담당 답변 작성 → 파트장 승인 시 지식화 · 미답변이면 관련 메일 발송이 막힙니다
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <b>운영 원리</b>
            </div>
            <div className="bd" style={{ fontSize: 12, lineHeight: 1.7 }}>
              메일(자동 수집)과 미팅 회의록(우려·질문 추출), 두 갈래에서 질문이 들어옵니다. 답장
              초안에 승인된 QnA가 자동 삽입되고, 새 질문은 [답변 필요]로 표시돼 채우기 전엔
              발송되지 않아요. 반복될수록 시스템이 똑똑해집니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
