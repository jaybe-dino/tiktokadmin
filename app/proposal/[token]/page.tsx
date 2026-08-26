import { notFound } from "next/navigation";
import { getProposalByToken, defaultTemplate, type ProposalDoc, type ProposalTemplate } from "@/lib/proposal-doc";
import { proposalImageUrl } from "@/lib/asset-url";
import PrintBar from "./PrintBar";

export const dynamic = "force-dynamic";

const won = (n: number | null | undefined) => (n == null ? "" : "₩" + Number(n).toLocaleString("ko-KR"));
// 원 → "N만" (상당 구성 가치 합계 표기).
const man = (n: number | null | undefined) => (n == null ? "" : Math.round(Number(n) / 10000).toLocaleString("ko-KR") + "만");
// 수량 문구에서 개별 단가(× N만/원/N,000원) 제거 — "20건 × 3만"·"20건 × 30,000원" → "20건".
const stripPrice = (q: string | null | undefined) => (q || "").replace(/\s*[×xX*]\s*[\d,]+\s*(만원?|원)/g, "").trim();
// hex 색상만 통과(그 외 null) — <style> 인라인 인젝션 방지.
const safeHexColor = (v: string | null | undefined): string | null => (v && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : null);

const TRACK_SUMMARY: Record<string, string> = { onboarding: "온보딩 트랙 제안 요약", mall: "멀티몰 트랙 제안 요약", marketing: "마케팅 트랙 제안 요약" };
// value_items 가 비어 있어도 구성 항목(금액 없이)은 항상 노출 — 온보딩 표준 구성.
const DEFAULT_VALUE_ITEMS: { label: string; qty?: string }[] = [
  { label: "시딩", qty: "20건" }, { label: "라이브 커머스", qty: "4건" }, { label: "인증 · 물류 관리" },
  { label: "마케팅 전략 컨설팅" }, { label: "전담 CS 매니저" }, { label: "전담 발주 관리" }, { label: "제품 등록 번역 초안" },
];
const TRACK_BADGE: Record<string, string> = { onboarding: "ONBOARDING TRACK", mall: "MULTI-MALL TRACK", marketing: "MARKETING TRACK" };

// 틱톡샵 시딩 벤치마크(베트남 · Beauty · 30일) — 업계 고정 상수(담당자 편집 대상 아님).
const BENCH = {
  cols: ["T1", "T2", "T3", "T4", "T5", "Beyond"],
  content: ["204", "992", "2,776", "6,327", "22,470", "82,509"],
  adspend: ["$1.4K", "$14K", "$30K", "$137K", "$438K", "$4.6M"],
};
const BENCH_NOTE =
  "기본 시딩은 최소 20건/월 기준 6개월 120건 · 12개월 240건이나, T2 기준 크리에이터 콘텐츠 992개에 맞춰 실제 운영은 누적 1,000건 이상을 목표로 확대합니다. GMV KPI 역시 단계별로 상향 조정합니다.";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await getProposalByToken(token);
  return { title: d ? `${d.brand_name || "브랜드"} · 제안서` : "제안서" };
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { token } = await params;
  const { preview } = await searchParams;
  const d = await getProposalByToken(token);
  if (!d) notFound();
  // 발행된 제안서만 공개. 초안·발행취소 링크는 404(관리자 미리보기만 ?preview=1 로 열람).
  if (d.status !== "published" && preview !== "1") notFound();
  // 이미지 URL 정리 — 보호 파일은 토큰 프록시, 외부 이미지는 웹썸네일 프록시(핫링크 차단·만료 URL 도 표시+영구 캐시).
  d.brand_logo_url = d.brand_logo_url ? proposalImageUrl(d.brand_logo_url, token) : d.brand_logo_url;
  d.products = d.products.map((p) => ({ ...p, image_url: p.image_url ? proposalImageUrl(p.image_url, token) : p.image_url }));
  d.creators = d.creators.map((c) => ({ ...c, thumb_url: c.thumb_url ? proposalImageUrl(c.thumb_url, token) : c.thumb_url }));
  const tpl = await defaultTemplate();
  // accent 는 <style> 안에 인라인되므로 반드시 hex 만 허용(CSS/스크립트 인젝션 차단).
  const accent = safeHexColor(d.accent) || safeHexColor(tpl?.accent) || "#ec4899";
  // 배경색(BUG-21) — 지정 시 표지 다크 그라디언트·페이지 틴트 계열을 이 색 기준으로 파생. 미지정이면 기본 핑크·보라.
  const bg = safeHexColor(d.accent2);
  const agency = tpl?.agency_name || "DINO STUDIO";
  const order = tpl?.sections?.length ? tpl.sections : ["cover", "product", "pricing", "operations", "kpi", "addon", "creators", "closing"];

  const sectionEls: Record<string, React.ReactNode> = {
    cover: <Cover key="cover" d={d} agency={agency} />,
    product: <ProductSection key="product" d={d} />,
    pricing: <PricingSection key="pricing" d={d} />,
    operations: <OperationsSection key="operations" d={d} />,
    kpi: <KpiSection key="kpi" d={d} />,
    addon: <AddonSection key="addon" d={d} />,
    creators: <CreatorsSection key="creators" d={d} />,
    closing: <Closing key="closing" d={d} agency={agency} tpl={tpl} />,
  };

  return (
    <div className="pp-root">
      <style dangerouslySetInnerHTML={{ __html: css(accent, bg) }} />
      <PrintBar accent={accent} />
      <main className="pp-doc">
        {order.map((k) => sectionEls[k]).filter(Boolean)}
        <footer className="pp-foot">{agency} · TikTok Shop Onboarding &amp; Marketing Proposal · 본 제안서는 수신자 전용입니다.</footer>
      </main>
    </div>
  );
}

// ── 표지 ──
function Cover({ d, agency }: { d: ProposalDoc; agency: string }) {
  return (
    <section className="pp-page pp-cover pp-dark">
      <div className="pp-cover-card">
        <h1>{d.title}</h1>
        <p className="pp-sub">{d.subtitle}</p>
        <p className="pp-en">TikTok Shop Marketing Proposal<br />Scaling Brands Through Creator Commerce</p>
        <div className="pp-rule" />
        <div className="pp-logos">
          <b className="pp-agency">{agency}</b>
          <span className="pp-x">×</span>
          {d.brand_logo_url
            ? <img className="pp-brandlogo" src={d.brand_logo_url} alt={d.brand_name} referrerPolicy="no-referrer" />
            : <b className="pp-brand">{d.brand_name || "BRAND"}</b>}
        </div>
      </div>
    </section>
  );
}

// ── 핵심 SKU ──
function ProductSection({ d }: { d: ProposalDoc }) {
  const p = d.products[0];
  if (!p && d.product_features.length === 0) return null;
  return (
    <section className="pp-page">
      <Eyebrow small="FEATURED PRODUCT" title="TikTok Shop 운영 핵심 SKU" sub={p?.desc || undefined} />
      <div className="pp-hero">
        <div className="pp-hero-img">
          {p?.image_url ? <img src={p.image_url} alt={p.name} referrerPolicy="no-referrer" /> : <div className="pp-hero-ph">{p?.name || "제품 이미지"}</div>}
        </div>
        <div className="pp-hero-body">
          {(p?.name || p?.desc) && <span className="pp-badge soft">주력제품{p?.desc ? ` · ${p.desc}` : ""}</span>}
          <h3 className="pp-hero-name">{p?.name || d.brand_name}</h3>
          {(d.product_en || d.product_volume) && (
            <p className="pp-hero-en">{[d.product_en, d.product_volume].filter(Boolean).join(" · ")}</p>
          )}
          <div className="pp-featcards">
            {d.product_features.map((f, i) => (
              <div key={i} className="pp-featcard"><b>{f.title}</b>{f.desc ? <span>{f.desc}</span> : null}</div>
            ))}
          </div>
          {d.product_tags.length > 0 && (
            <div className="pp-tags">{d.product_tags.map((t, i) => <span key={i} className="pp-tag">#{t}</span>)}</div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── 트랙 제안 요약(가격 + 상당 구성 가치) ──
function PricingSection({ d }: { d: ProposalDoc }) {
  // 가격·기능·가치표가 모두 비면(예: 마케팅/멀티몰 프리필 없음) 섹션 자체를 생략(빈 카드 방지).
  if (d.monthly_amount == null && d.list_amount == null && d.features.length === 0 &&
      d.value_items.length === 0 && d.value_total == null) return null;
  return (
    <section className="pp-page">
      <Eyebrow small={`${TRACK_BADGE[d.track] ?? d.track.toUpperCase()} · SUMMARY`} title={TRACK_SUMMARY[d.track] ?? "제안 요약"}
        sub="시딩·라이브 콘텐츠부터 인증·물류·CS·발주까지 운영 전반을 대행합니다." />
      <div className="pp-2col">
        <div className="pp-card">
          <span className="pp-track">{TRACK_BADGE[d.track] ?? d.track.toUpperCase()}</span>
          <div className="pp-price-row">
            {d.list_amount ? <span className="pp-list">{won(d.list_amount)}</span> : null}
            {d.list_amount ? <span className="pp-per">(국가 당)</span> : null}
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
        {(() => {
          // value_items 가 있으면 그대로, 없으면(온보딩) 표준 구성 항목(금액 없이)으로 폴백 — 항목은 항상 노출.
          const items = d.value_items.length > 0 ? d.value_items : (d.track === "onboarding" ? DEFAULT_VALUE_ITEMS : []);
          if (items.length === 0 && d.value_total == null) return null;
          return (
          <div className="pp-card pp-value">
            <div className="pp-value-head"><b>상당 구성 가치</b>{d.value_total != null && <span className="pp-value-strike"><s>{won(d.value_total)}</s> 상당</span>}</div>
            <div className="pp-value-list">
              {items.map((v, i) => {
                const qty = stripPrice(v.qty);
                return (
                  <div key={i} className="pp-value-row">
                    <span className="pp-value-label">{v.label}</span>
                    {qty ? <span className="pp-value-qty">{qty}</span> : null}
                  </div>
                );
              })}
            </div>
            {d.value_total != null && (
              <div className="pp-value-total"><span>합계 (상당)</span><b>{man(d.value_total)}원</b></div>
            )}
          </div>
          );
        })()}
      </div>
    </section>
  );
}

// ── 실행 로드맵 & 기대 효과 ──
function OperationsSection({ d }: { d: ProposalDoc }) {
  const has = d.roadmap_steps.length > 0 || d.impacts.length > 0 || d.seeding_qty != null || d.live_qty != null || d.op_tags.length > 0;
  if (!has) return null;
  return (
    <section className="pp-page">
      <Eyebrow small="EXECUTION & IMPACT" title="실행 로드맵 & 기대 효과" />
      {d.roadmap_steps.length > 0 && (
        <div className="pp-steps">
          {d.roadmap_steps.map((s, i) => (
            <div key={i} className="pp-step">
              <span className="pp-step-label">STEP {String(i + 1).padStart(2, "0")}</span>
              <div className="pp-step-head"><span className="pp-step-no">{i + 1}</span></div>
              <b className="pp-step-title">{s.title}</b>
              {s.desc ? <span className="pp-step-desc">{s.desc}</span> : null}
            </div>
          ))}
        </div>
      )}
      <div className="pp-2col">
        <div className="pp-card">
          <div className="pp-subhead">운영 &amp; 콘텐츠 <i>OPERATIONS</i></div>
          {d.seeding_qty != null && <div className="pp-op-row"><b>{d.seeding_qty}</b><i>건</i><span>크리에이터 시딩</span></div>}
          {d.live_qty != null && <div className="pp-op-row"><b>{d.live_qty}</b><i>건</i><span>라이브 커머스</span></div>}
          {d.op_tags.length > 0 && (
            <div className="pp-tags" style={{ marginTop: 14 }}>{d.op_tags.map((t, i) => <span key={i} className="pp-tag">#{t}</span>)}</div>
          )}
        </div>
        <div className="pp-card">
          <div className="pp-subhead">기대 효과 <i>IMPACT</i></div>
          <div className="pp-impacts">
            {d.impacts.map((m, i) => (
              <div key={i} className="pp-impact"><span className="pp-impact-ic">↗</span><div><b>{m.title}</b>{m.desc ? <span>{m.desc}</span> : null}</div></div>
            ))}
          </div>
        </div>
      </div>
      {(d.value_total != null || d.impact_banner) && (
        <div className="pp-banner">
          {d.value_total != null && <span className="pp-banner-l">{won(d.value_total)} 상당 구성</span>}
          {d.impact_banner && <span className="pp-banner-r">{d.impact_banner}</span>}
        </div>
      )}
    </section>
  );
}

// ── KPI 로드맵 ──
function KpiSection({ d }: { d: ProposalDoc }) {
  const has = d.kpi_creator_content != null || d.kpi_tier || d.kpi_year_creator_content != null || d.kpi_year_tier;
  if (!has) return null;
  return (
    <section className="pp-page">
      <Eyebrow small="KPI ROADMAP" title="6개월 · 1년 KPI 로드맵"
        sub="틱톡샵 시딩 벤치마크(베트남 · Beauty) 기준, 6개월 내 T1 · 1년 내 T2 티어 달성을 목표로 합니다." />
      <div className="pp-2col">
        <div className="pp-card pp-kpi">
          <div className="pp-kpi-head"><span className="pp-badge dark">6개월 KPI</span>{d.kpi_tier ? <b className="pp-tier">{d.kpi_tier}</b> : null}</div>
          {d.kpi_stage ? <div className="pp-kpi-stage">{d.kpi_stage}</div> : null}
          <div className="pp-kpi-grid">
            {d.kpi_creator_content != null && <div className="pp-kpi-box"><b>{Number(d.kpi_creator_content).toLocaleString("ko-KR")}</b><span>크리에이터 콘텐츠</span></div>}
            {d.kpi_ad_spend && <div className="pp-kpi-box"><b>{d.kpi_ad_spend}</b><span>샵 광고비 (참고)</span></div>}
          </div>
        </div>
        <div className="pp-card pp-kpi pp-kpi-hot">
          <div className="pp-kpi-head"><span className="pp-badge dark">1년 KPI</span>{d.kpi_year_tier ? <b className="pp-tier">{d.kpi_year_tier}</b> : null}</div>
          {d.kpi_year_stage ? <div className="pp-kpi-stage">{d.kpi_year_stage}</div> : null}
          <div className="pp-kpi-grid">
            {d.kpi_year_creator_content != null && <div className="pp-kpi-box"><b>{Number(d.kpi_year_creator_content).toLocaleString("ko-KR")}</b><span>크리에이터 콘텐츠</span></div>}
            {d.kpi_year_ad_spend && <div className="pp-kpi-box"><b>{d.kpi_year_ad_spend}</b><span>샵 광고비 (참고)</span></div>}
          </div>
        </div>
      </div>
      <div className="pp-bench-wrap">
        <table className="pp-bench">
          <thead>
            <tr><th>TikTok Shop 시딩 벤치마크<em>베트남(VN) · Beauty · 30일 기준</em></th>{BENCH.cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td><span className="pp-bench-tag">추천 기준</span>크리에이터 콘텐츠</td>{BENCH.content.map((v, i) => <td key={i} className="pp-bench-hot">{v}</td>)}</tr>
            <tr><td>샵 광고비 <em>(참고, USD)</em></td>{BENCH.adspend.map((v, i) => <td key={i}>{v}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="pp-note">{BENCH_NOTE}</p>
    </section>
  );
}

// ── 별도 제안 예정 항목 ──
function AddonSection({ d }: { d: ProposalDoc }) {
  if (d.addons.length === 0) return null;
  return (
    <section className="pp-page">
      <Eyebrow small="ADD-ON SCOPE" title="별도 제안 예정 항목"
        sub="아래 항목은 본 제안에 미포함이며, 초기 성과 확인 후 별도 제안으로 진행합니다." />
      <div className="pp-2col">
        {d.addons.map((a, i) => (
          <div key={i} className="pp-card pp-addon">
            <span className="pp-addon-ic">◆</span>
            {a.label ? <div className="pp-addon-label">{a.label}</div> : null}
            <b className="pp-addon-title">{a.title}</b>
            {a.desc ? <p className="pp-addon-desc">{a.desc}</p> : null}
            <div className="pp-addon-badges"><span className="pp-badge hot">별도 제안 예정</span><span className="pp-badge soft">본 제안 미포함</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 레퍼런스 케이스 ──
function CreatorsSection({ d }: { d: ProposalDoc }) {
  if (d.creators.length === 0) return null;
  return (
    <section className="pp-page">
      <Eyebrow small="REFERENCE CASES" title="크리에이터 콘텐츠 레퍼런스" />
      <div className="pp-creators">
        {d.creators.map((c, i) => (
          <article key={i} className="pp-creator">
            {c.link ? (
              <a className="pp-cr-media" href={c.link} target="_blank" rel="noreferrer" title="콘텐츠 원본 보기" style={{ display: "block" }}>
                {c.thumb_url ? <img src={c.thumb_url} alt={c.handle} referrerPolicy="no-referrer" /> : <div className="pp-cr-ph" />}
                <span className="pp-cr-play">▶</span>
              </a>
            ) : (
              <div className="pp-cr-media">
                {c.thumb_url ? <img src={c.thumb_url} alt={c.handle} referrerPolicy="no-referrer" /> : <div className="pp-cr-ph" />}
                {c.thumb_url ? <span className="pp-cr-play">▶</span> : null}
              </div>
            )}
            <div className="pp-cr-body">
              <div className="pp-cr-head">
                {(c.brand || c.product) ? <span className="pp-cr-brand">{c.brand || c.product}</span> : null}
                <b>{c.handle}</b>
              </div>
              {c.revenue ? <div className="pp-cr-rev"><b>{c.revenue}</b> 매출</div> : null}
              {c.caption ? <div className="pp-cr-cap">{c.caption}</div> : null}
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
  );
}

// ── 마무리 E.O.D. ──
function Closing({ d, agency, tpl }: { d: ProposalDoc; agency: string; tpl: ProposalTemplate | null }) {
  const hasContact = tpl?.contact_name || tpl?.contact_phone || tpl?.contact_email;
  return (
    <section className="pp-page pp-closing pp-dark">
      <div className="pp-eod">
        <b className="pp-eod-agency">{agency}</b>
        <div className="pp-eod-mark">E.O.D.</div>
        {hasContact && (
          <div className="pp-contact">
            <span className="pp-contact-eye">CONTACT US</span>
            {tpl?.contact_name && <b className="pp-contact-name">{tpl.contact_name}</b>}
            {tpl?.contact_title && <span className="pp-contact-title">{tpl.contact_title}</span>}
            {tpl?.contact_phone && <div className="pp-contact-row"><i>M.</i>{tpl.contact_phone}</div>}
            {tpl?.contact_email && <div className="pp-contact-row"><i>E.</i>{tpl.contact_email}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

// ── 공통 헤더 ──
function Eyebrow({ small, title, sub }: { small: string; title: string; sub?: string }) {
  return (
    <div className="pp-head">
      <div className="pp-eye">{small}</div>
      <h2 className="pp-title">{title}</h2>
      {sub ? <p className="pp-titlesub">{sub}</p> : null}
    </div>
  );
}

function css(accent: string, bg?: string | null): string {
  // 배경색(bg) 지정 시 틴트·라인·그라운드·다크 섹션을 그 색에서 파생(color-mix) — 미지정이면 기존 기본값 유지.
  const mix = (pct: number, base = "#ffffff") => (bg ? `color-mix(in srgb, ${bg} ${pct}%, ${base})` : null);
  const tint = mix(8) ?? "#fdeef5";
  const tint2 = mix(18) ?? "#fbdcea";
  const line = mix(15) ?? "#f3dbe7";
  const ground = bg ? `linear-gradient(180deg,${mix(6)},${mix(12)})` : "linear-gradient(180deg,#fdf1f7,#fbe8f1)";
  const darkBg = bg
    ? `radial-gradient(circle at 32% 42%, ${mix(55)} 0%, ${bg} 34%, color-mix(in srgb, ${bg} 55%, #000) 62%, color-mix(in srgb, ${bg} 22%, #000) 88%)`
    : `radial-gradient(circle at 32% 42%, #ff5fa0 0%, #b12768 34%, #4d1230 62%, #1a0a13 88%)`;
  const darkBase = bg ? `color-mix(in srgb, ${bg} 30%, #000)` : "#160a10";
  return `
  .pp-root{--acc:${accent};--hot:#f6339a;--ink:#17121a;--ink2:#5b4b55;--ink3:#9b8791;--tint:${tint};--tint2:${tint2};--line:${line};
    background:${ground};min-height:100vh;
    font-family:-apple-system,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",system-ui,sans-serif;color:var(--ink);
    /* 인쇄/PDF 시 배경색·그라디언트·다크 섹션이 유지되도록 강제. */
    -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .pp-root *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .pp-doc{max-width:1040px;margin:0 auto;padding:0 18px 60px;}
  .pp-page{background:var(--tint);border-radius:22px;box-shadow:0 10px 40px rgba(160,30,90,.08);padding:40px 40px;margin:22px 0;}
  .pp-card{background:#fff;border-radius:18px;padding:26px;box-shadow:0 6px 22px rgba(160,30,90,.06);}
  .pp-2col{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
  /* 공통 헤더 */
  .pp-head{margin-bottom:22px;}
  .pp-eye{font-size:12px;font-weight:800;letter-spacing:.2em;color:var(--acc);margin-bottom:8px;}
  .pp-title{font-size:28px;font-weight:900;letter-spacing:-.02em;margin:0;}
  .pp-titlesub{color:var(--ink2);font-size:14px;line-height:1.6;margin:10px 0 0;max-width:760px;}
  .pp-subhead{font-weight:900;font-size:17px;margin-bottom:14px;}
  .pp-subhead i{font-style:normal;font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--acc);margin-left:8px;}
  .pp-badge{display:inline-block;font-weight:800;font-size:12px;padding:6px 13px;border-radius:999px;}
  .pp-badge.soft{background:var(--tint2);color:var(--acc);}
  .pp-badge.hot{background:var(--acc);color:#fff;}
  .pp-badge.dark{background:#2a1620;color:#fff;}
  .pp-tags{display:flex;flex-wrap:wrap;gap:8px;}
  .pp-tag{display:inline-block;background:var(--tint2);color:var(--acc);font-weight:800;font-size:13px;padding:6px 12px;border-radius:999px;}
  /* dark 섹션(표지·마무리) */
  .pp-dark{background:${darkBase};position:relative;overflow:hidden;color:#fff;
    background-image:${darkBg};}
  /* 표지 */
  .pp-cover{display:grid;place-items:center;padding:70px 40px;}
  .pp-cover-card{position:relative;z-index:1;background:#fff;color:var(--ink);border-radius:22px;box-shadow:0 24px 70px rgba(0,0,0,.28);padding:60px 48px;text-align:center;max-width:640px;width:100%;}
  .pp-cover h1{font-size:32px;font-weight:900;letter-spacing:-.02em;margin:0;}
  .pp-cover .pp-sub{color:var(--acc);font-weight:800;font-size:18px;margin:14px 0 0;}
  .pp-cover .pp-en{color:var(--ink3);font-weight:700;font-size:13px;line-height:1.6;margin:18px 0 0;}
  .pp-rule{height:1px;background:var(--line);margin:24px auto;max-width:420px;}
  .pp-logos{display:flex;gap:22px;align-items:center;justify-content:center;}
  .pp-agency{font-weight:900;letter-spacing:.02em;font-size:19px;white-space:pre-line;}
  .pp-x{color:#d9b9cb;font-size:16px;}
  .pp-brand{font-weight:900;font-size:26px;color:var(--acc);font-style:italic;}
  .pp-brandlogo{max-height:44px;max-width:200px;object-fit:contain;}
  /* 히어로 제품 */
  .pp-hero{display:grid;grid-template-columns:1fr 1.15fr;gap:24px;align-items:start;}
  .pp-hero-img{background:#fff;border-radius:18px;padding:8px;box-shadow:0 6px 22px rgba(160,30,90,.06);}
  .pp-hero-img img{width:100%;height:340px;object-fit:contain;display:block;}
  .pp-hero-ph{height:340px;display:grid;place-items:center;color:var(--ink3);font-weight:800;}
  .pp-hero-name{font-size:26px;font-weight:900;margin:12px 0 2px;}
  .pp-hero-en{color:var(--ink3);font-weight:700;font-size:14px;margin:0 0 14px;}
  .pp-featcards{display:flex;flex-direction:column;gap:10px;}
  .pp-featcard{background:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 4px 14px rgba(160,30,90,.05);}
  .pp-featcard b{display:block;font-size:15px;margin-bottom:3px;}
  .pp-featcard span{font-size:13px;color:var(--ink2);line-height:1.55;}
  .pp-hero-body .pp-tags{margin-top:16px;}
  /* 가격 */
  .pp-track{display:inline-block;background:var(--acc);color:#fff;font-weight:800;font-size:12px;letter-spacing:.06em;padding:8px 16px;border-radius:999px;}
  .pp-price-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:20px 0 0;}
  .pp-list{font-size:20px;font-weight:800;color:#c9a7b8;text-decoration:line-through;}
  .pp-per{font-size:13px;color:var(--ink3);font-weight:700;}
  .pp-amount{font-size:44px;font-weight:900;letter-spacing:-.02em;line-height:1;flex-basis:100%;margin-top:4px;}
  .pp-amount small{font-size:18px;font-weight:800;color:var(--ink2);margin-left:6px;}
  .pp-terms{background:var(--tint);color:var(--acc);font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;margin:16px 0 0;}
  .pp-features{list-style:none;margin:18px 0 0;padding:0;}
  .pp-features li{display:flex;align-items:center;gap:12px;font-weight:700;font-size:15px;padding:12px 2px;border-top:1px solid var(--line);}
  .pp-features li:first-child{border-top:none;}
  .pp-ck{width:24px;height:24px;border-radius:999px;background:var(--tint2);color:var(--acc);display:grid;place-items:center;font-size:12px;font-weight:900;flex:0 0 auto;}
  /* 상당 구성 가치 */
  .pp-value-head{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--line);}
  .pp-value-head b{font-size:17px;font-weight:900;}
  .pp-value-strike{color:#c9a7b8;font-weight:800;font-size:14px;}
  .pp-value-strike s{text-decoration:line-through;}
  .pp-value-list{margin:6px 0;}
  .pp-value-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #f7e6ef;}
  .pp-value-label{font-weight:700;font-size:14px;}
  .pp-value-qty{color:var(--ink3);font-size:12px;}
  .pp-value-total{display:flex;justify-content:space-between;align-items:center;background:var(--acc);color:#fff;border-radius:12px;padding:14px 18px;margin-top:12px;font-weight:900;}
  .pp-value-total b{font-size:20px;}
  /* 로드맵 스텝 */
  .pp-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px;}
  .pp-step-label{font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--acc);}
  .pp-step-head{margin:8px 0 10px;}
  .pp-step-no{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--acc);color:#fff;font-weight:900;font-size:15px;}
  .pp-step-title{display:block;font-size:16px;font-weight:900;}
  .pp-step-desc{display:block;font-size:12.5px;color:var(--ink2);margin-top:4px;line-height:1.5;}
  /* 운영 수치 */
  .pp-op-row{display:flex;align-items:baseline;gap:8px;padding:14px 0;border-top:1px solid var(--line);}
  .pp-op-row:first-of-type{border-top:none;}
  .pp-op-row b{font-size:30px;font-weight:900;color:var(--acc);}
  .pp-op-row i{font-style:normal;font-size:14px;color:var(--acc);font-weight:700;}
  .pp-op-row span{font-size:17px;font-weight:800;margin-left:12px;}
  /* 기대 효과 */
  .pp-impacts{display:flex;flex-direction:column;gap:14px;}
  .pp-impact{display:flex;gap:12px;align-items:flex-start;}
  .pp-impact-ic{flex:0 0 auto;width:26px;height:26px;border-radius:8px;background:var(--tint2);color:var(--acc);display:grid;place-items:center;font-weight:900;font-size:13px;}
  .pp-impact b{display:block;font-size:15px;}
  .pp-impact span{display:block;font-size:13px;color:var(--ink2);line-height:1.5;margin-top:2px;}
  /* 배너 */
  .pp-banner{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:linear-gradient(135deg,#f472b6,var(--acc));color:#fff;border-radius:14px;padding:18px 24px;margin-top:18px;}
  .pp-banner-l{font-weight:800;font-size:15px;}
  .pp-banner-r{font-weight:900;font-size:17px;margin-left:auto;}
  /* KPI */
  .pp-kpi-head{display:flex;justify-content:space-between;align-items:center;}
  .pp-tier{font-size:28px;font-weight:900;}
  .pp-kpi-stage{font-size:18px;font-weight:800;margin:14px 0 0;}
  .pp-kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px;}
  .pp-kpi-box{background:var(--tint);border-radius:14px;padding:22px;text-align:center;}
  .pp-kpi-box b{display:block;font-size:32px;font-weight:900;color:var(--acc);}
  .pp-kpi-box span{color:var(--ink3);font-weight:700;font-size:13px;margin-top:6px;display:block;}
  .pp-kpi-hot{background:linear-gradient(135deg,#f472b6,var(--acc));color:#fff;}
  .pp-kpi-hot .pp-badge.dark{background:rgba(0,0,0,.28);}
  .pp-kpi-hot .pp-kpi-box{background:rgba(255,255,255,.18);}
  .pp-kpi-hot .pp-kpi-box b,.pp-kpi-hot .pp-kpi-box span{color:#fff;}
  /* 벤치마크 표 */
  .pp-bench-wrap{overflow-x:auto;margin-top:20px;}
  .pp-bench{width:100%;border-collapse:collapse;font-size:14px;min-width:640px;border-radius:12px;overflow:hidden;}
  .pp-bench th,.pp-bench td{padding:14px 12px;text-align:center;}
  .pp-bench thead th{background:#2a1620;color:#fff;font-weight:800;}
  .pp-bench thead th:first-child{text-align:left;}
  .pp-bench thead th em{display:block;font-style:normal;font-weight:600;font-size:11px;opacity:.7;margin-top:3px;}
  .pp-bench tbody td{border-bottom:1px solid var(--line);background:#fff;font-weight:800;}
  .pp-bench tbody td:first-child{text-align:left;font-weight:700;}
  .pp-bench tbody td em{font-style:normal;color:var(--ink3);font-size:11px;font-weight:600;}
  .pp-bench-hot{color:var(--acc);}
  .pp-bench-tag{display:inline-block;background:var(--tint2);color:var(--acc);font-size:10px;font-weight:800;padding:3px 8px;border-radius:999px;margin-right:8px;}
  .pp-note{border-left:3px solid var(--acc);background:#fff;border-radius:0 10px 10px 0;padding:14px 16px;font-size:13px;color:var(--ink2);line-height:1.6;margin-top:16px;}
  /* 애드온 */
  .pp-addon{position:relative;}
  .pp-addon-ic{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--tint2);color:var(--acc);font-size:15px;margin-bottom:14px;}
  .pp-addon-label{font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--acc);margin-bottom:6px;}
  .pp-addon-title{font-size:20px;font-weight:900;}
  .pp-addon-desc{font-size:13.5px;color:var(--ink2);line-height:1.6;margin:12px 0 18px;}
  .pp-addon-badges{display:flex;gap:8px;flex-wrap:wrap;}
  /* 레퍼런스 케이스 */
  .pp-creators{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;}
  .pp-creator{border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 6px 22px rgba(160,30,90,.07);}
  .pp-cr-media{position:relative;aspect-ratio:9/12;background:#f2d7e5;}
  .pp-cr-media img{width:100%;height:100%;object-fit:cover;display:block;}
  .pp-cr-ph{width:100%;height:100%;}
  .pp-cr-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:999px;background:rgba(255,255,255,.82);color:var(--acc);display:grid;place-items:center;font-size:15px;padding-left:3px;}
  .pp-cr-body{padding:14px 16px;}
  .pp-cr-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
  .pp-cr-brand{background:var(--tint2);color:var(--acc);font-weight:800;font-size:12px;padding:3px 10px;border-radius:999px;}
  .pp-cr-head b{font-weight:800;font-size:14px;}
  .pp-cr-rev{font-size:22px;color:var(--acc);font-weight:900;margin:10px 0 0;}
  .pp-cr-cap{font-size:12.5px;color:var(--ink2);margin-top:6px;line-height:1.5;}
  .pp-cr-metrics{display:flex;gap:16px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line);}
  .pp-cr-metrics span{display:block;color:var(--ink3);font-size:11px;}
  .pp-cr-metrics b{font-weight:900;font-size:16px;}
  /* 마무리 */
  .pp-closing{min-height:420px;display:grid;padding:56px 48px;}
  .pp-eod{position:relative;z-index:1;width:100%;}
  .pp-eod-agency{position:absolute;top:0;right:0;font-weight:900;font-size:15px;white-space:pre-line;text-align:right;line-height:1.2;}
  .pp-eod-mark{text-align:center;font-size:52px;font-weight:900;letter-spacing:.04em;padding:80px 0;}
  .pp-contact{position:absolute;left:0;bottom:0;}
  .pp-contact-eye{font-size:11px;font-weight:800;letter-spacing:.2em;opacity:.7;}
  .pp-contact-name{display:block;font-size:22px;font-weight:900;margin:8px 0 2px;}
  .pp-contact-title{display:block;opacity:.85;font-size:14px;}
  .pp-contact-row{margin-top:6px;font-weight:800;font-size:14px;}
  .pp-contact-row i{font-style:normal;opacity:.6;font-size:11px;margin-right:10px;letter-spacing:.05em;}
  .pp-foot{text-align:center;color:var(--ink3);font-size:12px;margin-top:24px;}
  /* printbar */
  .pp-printbar{position:sticky;top:0;z-index:20;display:flex;justify-content:flex-end;max-width:1040px;margin:0 auto;padding:14px 18px 0;}
  .pp-printbar button{color:#fff;font-weight:800;font-size:14px;border:none;border-radius:12px;padding:11px 18px;cursor:pointer;box-shadow:0 6px 18px rgba(160,30,90,.2);}
  @media print{
    @page{size:A4;margin:10mm;}
    .no-print{display:none!important;}
    .pp-root{background:#fff;}
    .pp-doc{max-width:none;padding:0;}
    /* 각 섹션을 페이지 단위로 — 잘림/디자인 깨짐 방지(데크처럼 한 장씩). */
    .pp-page{box-shadow:none;break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always;margin:0;border-radius:14px;}
    .pp-page:last-of-type{break-after:auto;page-break-after:auto;}
    .pp-card{box-shadow:none;border:1px solid var(--line);break-inside:avoid;}
    .pp-creator,.pp-featcard,.pp-step,.pp-impact,.pp-addon{break-inside:avoid;}
    /* 다크 섹션(표지·마무리) 배경·글자색 인쇄 유지. */
    .pp-dark{-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#fff;}
    .pp-bench-wrap{overflow:visible;}
    .pp-bench{min-width:0;font-size:12px;}
  }
  @media(max-width:820px){
    .pp-2col,.pp-hero{grid-template-columns:1fr;}
    .pp-steps{grid-template-columns:1fr 1fr;}
    .pp-amount{font-size:36px;}.pp-kpi-grid{grid-template-columns:1fr 1fr;}
    .pp-page{padding:28px 22px;}
  }
  `;
}
