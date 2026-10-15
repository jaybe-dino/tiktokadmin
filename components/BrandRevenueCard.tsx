import { revenueAmount, revenueView } from "@/lib/brand-revenue-view";

import BrandRevenueControls from "./BrandRevenueControls";

const SCOPE = { brand: "브랜드 기준", company_separate: "운영법인 별도 기준", company_consolidated: "운영법인 연결 기준" };
const CONFIDENCE = { high: "높음", medium: "보통", low: "낮음" };
export default function BrandRevenueCard({ value, brandId }: { value?: unknown; brandId?: string }) {
  const view = revenueView(value), e = view.estimate;
  return (
    <section aria-labelledby="estimated-revenue-title" data-testid="brand-revenue-card" style={{
      border: "2px solid #6366f1", borderRadius: 16, padding: "22px clamp(16px, 3vw, 28px)",
      background: "linear-gradient(120deg, #eef2ff, #faf5ff)", marginBottom: 16,
      boxShadow: "0 5px 20px #4338ca12", color: "#1e1b4b", overflowWrap: "anywhere",
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h2 id="estimated-revenue-title" style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>예상 연매출</h2>
        <span style={{ fontSize: 12, fontWeight: 700, border: "1px solid #c7d2fe", background: "#fff", borderRadius: 99, padding: "5px 10px" }}>{view.label}</span>
      </div>
      <div style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 850, lineHeight: 1.3, letterSpacing: "-0.03em", margin: "12px 0 8px" }}>
        {e ? `${revenueAmount(e.lower, e.currency)}${e.lower === e.upper ? "" : ` ~ ${revenueAmount(e.upper, e.currency)}`}` : view.label}
      </div>
      {e && <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 6 }}>{e.year}년 · {e.entity} · {SCOPE[e.scope]} · 신뢰도 {CONFIDENCE[e.confidence]}</div>}
      <p style={{ fontSize: 12, lineHeight: 1.7, margin: 0, color: "#4c4676" }}>{view.detail}</p>
      {brandId && <BrandRevenueControls brandId={brandId} busy={view.label === "추정 대기" || view.label === "추정 중"} canRetry={view.label === "추정 대기" && !!(value && typeof value === "object" && "reason" in value)} />}
      {e && <details style={{ marginTop: 12, fontSize: 12, lineHeight: 1.8 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>추정 근거·출처 보기</summary>
        <p style={{ whiteSpace: "pre-wrap" }}>{e.rationale}</p>
        <ul style={{ paddingLeft: 20 }}>{e.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "#4338ca", textDecoration: "underline" }}>{s.title}</a></li>)}</ul>
        <div>추정 시각: {new Date(e.estimated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)</div>
      </details>}
    </section>
  );
}
