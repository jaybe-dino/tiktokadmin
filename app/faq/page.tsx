import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: "GloveK · 자주 묻는 질문 (FAQ)" };

// 외부 공개 QnA(FAQ) — 승인된 qna_entries 만 노출. 로그인 불필요(포털/관리자 양 호스트).
export default async function FaqPage() {
  const rows = (await query<{ question: string; answer: string; category: string | null }>(
    `SELECT question, answer, category FROM qna_entries
      WHERE approved = true AND answer IS NOT NULL AND btrim(answer) <> ''
      ORDER BY category NULLS LAST, usage_count DESC, created_at DESC LIMIT 500`,
  ).catch(() => [])) as { question: string; answer: string; category: string | null }[];

  // 카테고리별 그룹(등장 순 보존).
  const cats: string[] = [];
  for (const r of rows) { const c = (r.category || "일반").trim() || "일반"; if (!cats.includes(c)) cats.push(c); }

  return (
    <div className="faq-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="faq-head">
        <div className="faq-eyebrow">GloveK · TikTok Shop</div>
        <h1>자주 묻는 질문</h1>
        <p>틱톡샵 해외진출·운영대행에 대해 자주 주시는 질문을 모았습니다.</p>
      </header>

      {rows.length === 0 ? (
        <div className="faq-empty">등록된 FAQ가 아직 없습니다.</div>
      ) : (
        cats.map((cat) => (
          <section key={cat} className="faq-cat">
            <h2>{cat}</h2>
            <div className="faq-list">
              {rows.filter((r) => ((r.category || "일반").trim() || "일반") === cat).map((r, i) => (
                <details key={i} className="faq-item">
                  <summary><span className="q">Q.</span>{r.question}</summary>
                  <div className="faq-ans">{r.answer}</div>
                </details>
              ))}
            </div>
          </section>
        ))
      )}

      <footer className="faq-foot">© GloveK · 문의는 담당자에게 회신 주세요.</footer>
    </div>
  );
}

const CSS = `
  .faq-root{max-width:760px;margin:0 auto;padding:0 18px 80px;
    font-family:-apple-system,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",system-ui,sans-serif;
    color:#1c1420;background:#fff;min-height:100vh;}
  .faq-head{padding:56px 0 8px;}
  .faq-eyebrow{font-size:12px;font-weight:800;letter-spacing:.18em;color:#e84a80;text-transform:uppercase;}
  .faq-head h1{font-size:30px;font-weight:900;letter-spacing:-.02em;margin:12px 0 8px;}
  .faq-head p{color:#7a6b74;font-size:15px;margin:0;}
  .faq-cat{margin-top:34px;}
  .faq-cat h2{font-size:16px;font-weight:800;color:#c0326a;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #fbe1ec;}
  .faq-list{display:flex;flex-direction:column;gap:10px;}
  .faq-item{border:1px solid #f0e2ea;border-radius:12px;background:#fffafc;overflow:hidden;}
  .faq-item summary{list-style:none;cursor:pointer;padding:16px 18px;font-weight:700;font-size:15px;display:flex;gap:10px;align-items:flex-start;}
  .faq-item summary::-webkit-details-marker{display:none;}
  .faq-item summary .q{color:#e84a80;font-weight:900;flex:0 0 auto;}
  .faq-item[open]{background:#fff;border-color:#f4c6db;}
  .faq-item[open] summary{border-bottom:1px solid #f6e6ee;}
  .faq-ans{padding:14px 18px 18px 40px;color:#41353d;font-size:14.5px;line-height:1.7;white-space:pre-wrap;}
  .faq-empty,.faq-foot{color:#a99aa3;text-align:center;}
  .faq-empty{padding:60px 0;}
  .faq-foot{margin-top:44px;font-size:12.5px;}
  @media(max-width:560px){.faq-head h1{font-size:25px}}
`;
