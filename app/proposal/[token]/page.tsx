import { notFound } from "next/navigation";
import { getProposalByToken, defaultTemplate, trackLabel, type ProposalDoc } from "@/lib/proposal-doc";
import PrintBar from "./PrintBar";

export const dynamic = "force-dynamic";

const won = (n: number | null) => (n == null ? "" : "₩" + Number(n).toLocaleString("ko-KR"));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await getProposalByToken(token);
  return { title: d ? `${d.brand_name || "브랜드"} · 제안서` : "제안서" };
}

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await getProposalByToken(token);
  if (!d) notFound();
  const tpl = await defaultTemplate();
  const accent = d.accent || tpl?.accent || "#1f7a4d";
  const agency = tpl?.agency_name || "DINO STUDIO";

  return (
    <div className="pp-root">
      <style dangerouslySetInnerHTML={{ __html: css(accent) }} />
      <PrintBar accent={accent} />
      <main className="pp-doc">

        {/* ① 표지 */}
        <section className="pp-page pp-cover">
          <div className="pp-cover-card">
            <h1>{d.title}</h1>
            <p className="pp-sub">{d.subtitle}</p>
            <p className="pp-en">TikTok Shop Marketing Proposal<br />Scaling Brands Through Creator Commerce</p>
            <div className="pp-rule" />
            <div className="pp-logos">
              <b className="pp-agency">{agency}</b>
              <span className="pp-x">×</span>
              {d.brand_logo_url
                ? <img className="pp-brandlogo" src={d.brand_logo_url} alt={d.brand_name} />
                : <b className="pp-brand">{d.brand_name || "BRAND"}</b>}
            </div>
          </div>
        </section>

        {/* ② 제품 쇼케이스 */}
        {d.products.length > 0 && (
          <section className="pp-page">
            <div className="pp-eyebrow">제품 <span>PRODUCTS</span></div>
            <div className="pp-products">
              {d.products.map((p, i) => (
                <figure key={i} className="pp-prod">
                  {p.image_url ? <img src={p.image_url} alt={p.name} /> : <div className="pp-prod-ph">{p.name}</div>}
                  <figcaption><b>{p.name}</b>{p.desc ? <span>{p.desc}</span> : null}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* ③ 가격 카드 */}
        <section className="pp-page">
          <div className="pp-price-card">
            <span className="pp-track">{trackLabel(d.track)}</span>
            <div className="pp-price-row">
              {d.list_amount ? <span className="pp-list">{won(d.list_amount)}</span> : null}
              <span className="pp-amount">{won(d.monthly_amount)}<small>/ 월</small></span>
            </div>
            {(d.fee_pct != null || d.term_discount_pct != null) && (
              <div className="pp-terms">
                + {d.fee_pct != null ? `판매 수수료 ${Number(d.fee_pct)}%` : ""}
                {d.fee_pct != null && d.term_discount_pct != null ? " · " : ""}
                {d.term_discount_pct != null ? `${d.term_months ?? 6}개월 약정 시 ${d.term_discount_pct}% 추가 할인` : ""}
              </div>
            )}
            <ul className="pp-features">
              {d.features.map((f, i) => <li key={i}><span className="pp-ck">✓</span>{f}</li>)}
            </ul>
          </div>
        </section>

        {/* ④ 운영 & 콘텐츠 */}
        {(d.seeding_qty != null || d.live_qty != null || d.op_tags.length > 0) && (
          <section className="pp-page">
            <div className="pp-eyebrow">운영 &amp; 콘텐츠 <span>OPERATIONS</span></div>
            <div className="pp-ops">
              {d.seeding_qty != null && <div className="pp-op-row"><b>{d.seeding_qty}</b><i>건</i><span>크리에이터 시딩</span></div>}
              {d.live_qty != null && <div className="pp-op-row"><b>{d.live_qty}</b><i>건</i><span>라이브 커머스</span></div>}
            </div>
            {d.op_tags.length > 0 && (
              <div className="pp-optags">
                <span className="pp-optags-label">Operation</span>
                {d.op_tags.map((t, i) => <span key={i} className="pp-tag">#{t}</span>)}
              </div>
            )}
          </section>
        )}

        {/* ⑤ 6개월 KPI */}
        {(d.kpi_creator_content != null || d.kpi_ad_spend || d.kpi_tier) && (
          <section className="pp-page">
            <div className="pp-kpi-card">
              <div className="pp-kpi-head">
                <span className="pp-kpi-badge">6개월 KPI</span>
                {d.kpi_tier ? <b className="pp-tier">{d.kpi_tier}</b> : null}
              </div>
              {d.kpi_stage ? <div className="pp-kpi-stage">{d.kpi_stage}</div> : null}
              <div className="pp-kpi-grid">
                {d.kpi_creator_content != null && <div className="pp-kpi-box"><b>{Number(d.kpi_creator_content).toLocaleString("ko-KR")}</b><span>크리에이터 콘텐츠</span></div>}
                {d.kpi_ad_spend && <div className="pp-kpi-box"><b>{d.kpi_ad_spend}</b><span>샵 광고비 (참고)</span></div>}
              </div>
            </div>
          </section>
        )}

        {/* ⑦ 크리에이터 레퍼런스 */}
        {d.creators.length > 0 && (
          <section className="pp-page">
            <div className="pp-eyebrow">크리에이터 레퍼런스 <span>CREATOR REFERENCES</span></div>
            <div className="pp-creators">
              {d.creators.map((c, i) => (
                <article key={i} className="pp-creator">
                  <div className="pp-cr-media">
                    {c.thumb_url ? <img src={c.thumb_url} alt={c.handle} /> : <div className="pp-cr-ph" />}
                    {c.caption ? <div className="pp-cr-cap">{c.caption}</div> : null}
                  </div>
                  <div className="pp-cr-body">
                    <div className="pp-cr-head">{c.product ? <span className="pp-cr-prod">{c.product}</span> : null}<b>{c.handle}</b></div>
                    {c.revenue ? <div className="pp-cr-rev"><b>{c.revenue}</b> 매출</div> : null}
                    <div className="pp-cr-metrics">
                      {c.roas ? <div><span>ROAS</span><b>{c.roas}</b></div> : null}
                      {c.fee_rate ? <div><span>수수료율</span><b>{c.fee_rate}</b></div> : null}
                      {c.engagement ? <div><span>참여율</span><b>{c.engagement}</b></div> : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ⑧ 클로징 */}
        <section className="pp-page pp-closing">
          <div className="pp-close-card">
            <h2>함께 성장할 준비가 되었습니다</h2>
            <p>{d.brand_name ? `${d.brand_name}의 ` : ""}틱톡샵 진출과 크리에이터 커머스, {agency}가 처음부터 끝까지 함께합니다.</p>
            <div className="pp-logos small"><b className="pp-agency">{agency}</b><span className="pp-x">×</span><b className="pp-brand">{d.brand_name || "BRAND"}</b></div>
          </div>
        </section>

        <footer className="pp-foot">{agency} · TikTok Shop Onboarding &amp; Marketing Proposal · 본 제안서는 수신자 전용입니다.</footer>
      </main>
    </div>
  );
}

function css(accent: string): string {
  return `
  .pp-root{--acc:${accent};--ink:#12241b;--ink2:#3f5a4c;--ink3:#7b9184;--tint:#eef7f2;--tint2:#e2f1e9;
    background:linear-gradient(180deg,#f3f7f5,#eaf1ee);min-height:100vh;
    font-family:-apple-system,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",system-ui,sans-serif;color:var(--ink);}
  .pp-doc{max-width:960px;margin:0 auto;padding:0 18px 60px;}
  .pp-page{background:#fff;border-radius:22px;box-shadow:0 10px 40px rgba(20,60,42,.08);padding:44px 40px;margin:22px 0;}
  .pp-eyebrow{font-size:22px;font-weight:800;letter-spacing:-.01em;margin-bottom:22px;display:flex;align-items:baseline;gap:10px;}
  .pp-eyebrow span{font-size:12px;font-weight:800;letter-spacing:.18em;color:var(--acc);}
  /* cover */
  .pp-cover{background:transparent;box-shadow:none;padding:40px 0;}
  .pp-cover-card{background:#fff;border-radius:22px;box-shadow:0 18px 60px rgba(20,60,42,.12);padding:64px 40px;text-align:center;}
  .pp-cover h1{font-size:34px;font-weight:800;letter-spacing:-.02em;margin:0;}
  .pp-cover .pp-sub{color:var(--acc);font-weight:800;font-size:19px;margin:14px 0 0;}
  .pp-cover .pp-en{color:var(--ink3);font-weight:700;font-size:14px;line-height:1.6;margin:22px 0 0;}
  .pp-rule{height:1px;background:#e5ece8;margin:26px auto;max-width:420px;}
  .pp-logos{display:flex;gap:22px;align-items:center;justify-content:center;}
  .pp-logos.small{margin-top:22px;}
  .pp-agency{font-weight:900;letter-spacing:.02em;font-size:20px;color:var(--ink);white-space:pre-line;}
  .pp-x{color:#c7d6ce;font-size:18px;}
  .pp-brand{font-weight:900;font-size:26px;color:var(--acc);}
  .pp-brandlogo{max-height:46px;max-width:200px;object-fit:contain;}
  /* products */
  .pp-products{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;}
  .pp-prod{margin:0;background:var(--tint);border-radius:16px;overflow:hidden;}
  .pp-prod img{width:100%;height:230px;object-fit:contain;background:#fff;display:block;}
  .pp-prod-ph{height:230px;display:grid;place-items:center;color:var(--ink3);font-weight:700;background:#fff;}
  .pp-prod figcaption{padding:12px 14px;display:flex;flex-direction:column;gap:2px;}
  .pp-prod figcaption b{font-size:14px;}.pp-prod figcaption span{font-size:12px;color:var(--ink3);}
  /* pricing */
  .pp-price-card{padding:6px 4px;}
  .pp-track{display:inline-block;background:var(--acc);color:#fff;font-weight:800;font-size:13px;letter-spacing:.06em;padding:9px 18px;border-radius:999px;}
  .pp-price-row{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;margin:22px 0 0;}
  .pp-list{font-size:26px;font-weight:800;color:#a9bcb2;text-decoration:line-through;}
  .pp-amount{font-size:52px;font-weight:900;letter-spacing:-.02em;line-height:1;}
  .pp-amount small{font-size:20px;font-weight:800;color:var(--ink2);margin-left:6px;}
  .pp-terms{background:var(--tint);color:var(--ink2);font-weight:800;font-size:15px;padding:14px 18px;border-radius:14px;margin:18px 0 0;}
  .pp-features{list-style:none;margin:22px 0 0;padding:0;}
  .pp-features li{display:flex;align-items:center;gap:12px;font-weight:700;font-size:16px;padding:14px 2px;border-top:1px solid #eef2f0;}
  .pp-features li:first-child{border-top:none;}
  .pp-ck{width:26px;height:26px;border-radius:999px;background:var(--tint2);color:var(--acc);display:grid;place-items:center;font-size:13px;font-weight:900;flex:0 0 auto;}
  /* operations */
  .pp-ops{display:flex;flex-direction:column;}
  .pp-op-row{display:flex;align-items:baseline;gap:8px;padding:18px 0;border-top:1px solid #eef2f0;}
  .pp-op-row:first-child{border-top:none;}
  .pp-op-row b{font-size:34px;font-weight:900;color:var(--acc);}
  .pp-op-row i{font-style:normal;font-size:15px;color:var(--acc);font-weight:700;}
  .pp-op-row span{font-size:19px;font-weight:800;margin-left:14px;}
  .pp-optags{margin-top:18px;}
  .pp-optags-label{display:block;color:var(--ink3);font-weight:800;font-size:13px;margin-bottom:10px;}
  .pp-tag{display:inline-block;background:var(--tint2);color:var(--ink2);font-weight:800;font-size:14px;padding:8px 14px;border-radius:999px;margin:0 8px 8px 0;}
  /* kpi */
  .pp-kpi-card{padding:4px;}
  .pp-kpi-head{display:flex;justify-content:space-between;align-items:center;}
  .pp-kpi-badge{background:var(--ink);color:#fff;font-weight:800;font-size:14px;padding:9px 18px;border-radius:999px;}
  .pp-tier{font-size:30px;font-weight:900;}
  .pp-kpi-stage{font-size:22px;font-weight:800;margin:16px 0 0;}
  .pp-kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px;}
  .pp-kpi-box{background:var(--tint);border-radius:16px;padding:26px;text-align:center;}
  .pp-kpi-box b{display:block;font-size:38px;font-weight:900;color:var(--acc);}
  .pp-kpi-box span{color:var(--ink3);font-weight:700;font-size:14px;margin-top:6px;display:block;}
  /* creators */
  .pp-creators{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;}
  .pp-creator{border:1px solid #eef2f0;border-radius:18px;overflow:hidden;background:#fff;}
  .pp-cr-media{position:relative;aspect-ratio:9/12;background:#dfeae4;}
  .pp-cr-media img{width:100%;height:100%;object-fit:cover;display:block;}
  .pp-cr-ph{width:100%;height:100%;}
  .pp-cr-cap{position:absolute;left:0;right:0;bottom:0;padding:10px 12px;background:linear-gradient(transparent,rgba(0,0,0,.55));color:#fff;font-weight:700;font-size:13px;}
  .pp-cr-body{padding:16px;}
  .pp-cr-head{display:flex;align-items:center;gap:8px;}
  .pp-cr-prod{background:var(--tint2);color:var(--acc);font-weight:800;font-size:12px;padding:4px 10px;border-radius:999px;}
  .pp-cr-head b{font-weight:800;}
  .pp-cr-rev{font-size:24px;color:var(--acc);font-weight:900;margin:12px 0 0;}
  .pp-cr-rev b{font-weight:900;}
  .pp-cr-metrics{display:flex;gap:18px;margin-top:14px;padding-top:12px;border-top:1px solid #eef2f0;}
  .pp-cr-metrics span{display:block;color:var(--ink3);font-size:12px;}
  .pp-cr-metrics b{font-weight:900;font-size:17px;}
  /* closing */
  .pp-closing{background:var(--acc);color:#fff;text-align:center;}
  .pp-close-card h2{font-size:28px;font-weight:900;margin:0;}
  .pp-close-card p{font-size:15px;opacity:.92;margin:14px 0 0;line-height:1.6;}
  .pp-closing .pp-agency,.pp-closing .pp-brand{color:#fff;}
  .pp-closing .pp-x{color:rgba(255,255,255,.6);}
  .pp-foot{text-align:center;color:var(--ink3);font-size:12px;margin-top:24px;}
  /* printbar */
  .pp-printbar{position:sticky;top:0;z-index:20;display:flex;justify-content:flex-end;max-width:960px;margin:0 auto;padding:14px 18px 0;}
  .pp-printbar button{color:#fff;font-weight:800;font-size:14px;border:none;border-radius:12px;padding:11px 18px;cursor:pointer;box-shadow:0 6px 18px rgba(20,60,42,.2);}
  @media print{
    .no-print{display:none!important;}
    .pp-root{background:#fff;}
    .pp-doc{max-width:none;padding:0;}
    .pp-page,.pp-cover-card{box-shadow:none;border:1px solid #eef2f0;break-inside:avoid;page-break-inside:avoid;margin:0 0 14px;}
    .pp-cover{padding:0;}
  }
  @media(max-width:640px){.pp-page{padding:28px 20px;}.pp-amount{font-size:40px;}.pp-kpi-grid{grid-template-columns:1fr;}}
  `;
}
