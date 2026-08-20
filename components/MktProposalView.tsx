// 마케팅 제안서 렌더 — PDF 데크형 슬라이드 디자인(순수, db 의존 없음). 서버 페이지·에디터 미리보기 공용.
import {
  computeBudgetPlan, wonMan, COUNTRY_CALENDAR, COUNTRY_LABEL, PHASE_RATIO, PHASE_MEANING,
  type MktCountry, type Phase,
} from "@/lib/mkt-proposal-engine";
import type { MktProposalDocRow } from "@/lib/mkt-proposal-doc";

const safeHex = (v: string | null | undefined) => (v && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : "#111827");

const BENCH = {
  cols: ["T1", "T2", "T3", "T4", "T5", "Beyond"],
  content: ["204", "992", "2,776", "6,327", "22,470", "82,509"],
  adspend: ["$1.4K", "$14K", "$30K", "$137K", "$438K", "$4.6M"],
};
const STEPS = [
  { k: "STEP 01", en: "Seed", t: "시딩", d: "다양한 콘텐츠·크리에이터를 테스트해 대량 콘텐츠를 확보합니다." },
  { k: "STEP 02", en: "Identify", t: "콘텐츠 발굴", d: "조회수·전환·판매 성과를 분석해 가능성 있는 콘텐츠를 발굴합니다." },
  { k: "STEP 03", en: "Amplify", t: "증액", d: "성과가 검증된 콘텐츠에만 광고비를 집중하고 유가 캠페인을 확대합니다." },
];
const CONFIRM = [
  "6개월 예산 · 월별 시딩 · 라이브 운영 규모 확정",
  "GMV 광고 최소 집행 · 증액 기준 합의",
  "운영 대행 범위(물류 · CS · 발주) 확정",
];
const PHASE_ORDER: Phase[] = ["BUILD", "GROWTH", "PEAK", "MEGA"];
const PHASE_COLOR: Record<Phase, string> = { BUILD: "#64748b", GROWTH: "#0ea5e9", PEAK: "#f59e0b", MEGA: "#ef4444" };

export default function MktProposalView({ doc }: { doc: MktProposalDocRow }) {
  const accent = safeHex(doc.accent);
  const brand = doc.brand_name ?? "";
  const countries = (doc.countries?.length ? doc.countries : ["US"]).filter((c) => c in COUNTRY_CALENDAR) as MktCountry[];
  const ratios = { ...PHASE_RATIO } as typeof PHASE_RATIO;
  for (const p of PHASE_ORDER) {
    const o = doc.phase_ratios_json?.[p];
    if (o && Number.isFinite(o.organic) && Number.isFinite(o.paid)) ratios[p] = { organic: o.organic, paid: o.paid };
  }
  const plans = countries.map((c) => ({
    country: c,
    plan: computeBudgetPlan({
      monthlyBudget: doc.monthly_budget, country: c, startMonth: doc.start_month, months: doc.months,
      operationFee: doc.operation_fee, gmvReserveMin: doc.gmv_reserve_min, gmvReserveMax: doc.gmv_reserve_max,
      firstMonthSeedingOnly: doc.first_month_seeding, phaseRatios: ratios, overrides: doc.month_overrides_json ?? [],
    }),
  }));
  const products = (doc.products_json ?? []).filter((p) => p.name || p.image_url);
  const refs = doc.references_json ?? [];

  return (
    <div style={{ background: "#e9ebef", padding: "18px 12px" }}>
      <style>{`
        @media print { @page { size: A4 landscape; margin: 0; } .mp-slide { page-break-after: always; box-shadow:none !important; } }
      `}</style>
      <div style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 18 }}>

        {/* ── 표지 ── */}
        <Slide dark accent={accent} pad={0}>
          <div style={{ position: "relative", minHeight: 420, padding: "48px 52px", display: "flex", flexDirection: "column", justifyContent: "space-between",
            background: `radial-gradient(1200px 400px at 90% -10%, ${accent}44, transparent), linear-gradient(135deg, #0b1220 0%, #111827 60%, ${accent}22 100%)` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: 12, letterSpacing: 3, color: "#cbd5e1", fontWeight: 700 }}>TIKTOK SHOP · MARKETING PROPOSAL</div>
              <div style={{ fontWeight: 800, letterSpacing: 1, color: "#fff", fontSize: 13, textAlign: "right", lineHeight: 1.2 }}>DINO<br />STUDIO</div>
            </div>
            <div>
              {brand && <div style={{ color: accentText(accent), fontWeight: 800, fontSize: 15, marginBottom: 8, letterSpacing: 1 }}>{brand.toUpperCase()}</div>}
              <h1 style={{ color: "#fff", fontSize: 40, fontWeight: 800, margin: 0, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
                {doc.title || `${brand} 마케팅 협업 제안서`}
              </h1>
              {doc.subtitle && <div style={{ color: "#cbd5e1", fontSize: 17, marginTop: 10 }}>{doc.subtitle}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {countries.map((c) => <Chip key={c} tone="onDark">{COUNTRY_LABEL[c]}</Chip>)}
              <Chip tone="onDark">{doc.months}개월 캠페인</Chip>
              <Chip tone="onDark">월 예산 {wonMan(doc.monthly_budget)}</Chip>
            </div>
          </div>
          {/* 제품 히어로 스트립 */}
          {products.some((p) => p.image_url) && (
            <div style={{ display: "flex", gap: 0, background: "#0b1220" }}>
              {products.filter((p) => p.image_url).slice(0, 4).map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p.image_url} alt={p.name} style={{ flex: 1, height: 110, objectFit: "cover", borderRight: i < 3 ? "2px solid #0b1220" : "none" }} />
              ))}
            </div>
          )}
        </Slide>

        {/* ── 제품(핵심 SKU) ── */}
        {products.length > 0 && (
          <Slide accent={accent}>
            <Head accent={accent} kicker="PRODUCT" title="핵심 SKU" />
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(products.length, 3)}, 1fr)`, gap: 16 }}>
              {products.slice(0, 6).map((p, i) => (
                <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
                  {p.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.image_url} alt={p.name} style={{ width: "100%", height: 160, objectFit: "cover", display: "block", background: "#f1f5f9" }} />
                    : <div style={{ height: 160, background: `linear-gradient(135deg,#f1f5f9,${accent}18)`, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: 12 }}>이미지 없음</div>}
                  <div style={{ padding: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: accent }}>{String(i + 1).padStart(2, "0")}</div>
                    <div style={{ fontWeight: 800, fontSize: 15, marginTop: 2 }}>{p.name}</div>
                    {(p.name_en || p.volume) && <div style={{ fontSize: 12, color: "#94a3b8" }}>{[p.name_en, p.volume].filter(Boolean).join(" · ")}</div>}
                    {(p.features ?? []).filter(Boolean).length > 0 && (
                      <ul style={{ margin: "10px 0 0", paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
                        {(p.features ?? []).filter(Boolean).slice(0, 4).map((f, j) => (
                          <li key={j} style={{ fontSize: 12.5, color: "#374151", display: "flex", gap: 6 }}>
                            <span style={{ color: accent, fontWeight: 800 }}>·</span><span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Slide>
        )}

        {/* ── 목표 · 트랙 · 광고집행단계 ── */}
        <Slide accent={accent}>
          <Head accent={accent} kicker="GOAL & PROCESS" title="목표 · 진행 트랙 · 광고 집행 단계" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
            <GoalBox accent={accent} tag="1ST GOAL" label="1차 목표" value={doc.goal_first || "T1 기준 콘텐츠 204건 달성"} />
            <GoalBox accent={accent} tag="FINAL GOAL" label="최종 목표" value={doc.goal_final || "T2 진입 · 판매 기반 확립"} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {STEPS.map((s, i) => (
              <div key={s.k} style={{ position: "relative", border: "1px solid #e5e7eb", borderRadius: 14, padding: 16, background: "#fff" }}>
                <div style={{ position: "absolute", top: 14, right: 14, fontSize: 34, fontWeight: 800, color: `${accent}22` }}>{String(i + 1).padStart(2, "0")}</div>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: accent }}>{s.k}</div>
                <div style={{ fontWeight: 800, fontSize: 16, marginTop: 4 }}>{s.en} <span style={{ color: "#64748b", fontWeight: 700, fontSize: 13 }}>· {s.t}</span></div>
                <div style={{ fontSize: 12.5, color: "#475569", marginTop: 8, lineHeight: 1.6 }}>{s.d}</div>
              </div>
            ))}
          </div>
        </Slide>

        {/* ── 시즌 페이즈 모델 ── */}
        <Slide accent={accent}>
          <Head accent={accent} kicker="SEASON PHASE MODEL" title="BUILD → GROWTH → PEAK → MEGA" sub="시즌 단계에 따라 무가:유가 비중을 자동 조정합니다. 첫 달은 100% 무가 시딩으로 시작합니다." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {PHASE_ORDER.map((p) => {
              const r = ratios[p]; const total = (r.organic + r.paid) || 1;
              return (
                <div key={p} style={{ border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
                  <div style={{ background: PHASE_COLOR[p], color: "#fff", padding: "10px 14px", fontWeight: 800, letterSpacing: 1, display: "flex", justifyContent: "space-between" }}>
                    <span>{p}</span><span>{r.organic}:{r.paid}</span>
                  </div>
                  <div style={{ padding: 14 }}>
                    <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                      <div style={{ width: `${(r.organic / total) * 100}%`, background: PHASE_COLOR[p] }} />
                      <div style={{ width: `${(r.paid / total) * 100}%`, background: "#e2e8f0" }} />
                    </div>
                    <div style={{ fontSize: 11.5, color: "#64748b" }}>무가 <b style={{ color: "#111827" }}>{r.organic}</b> · 유가 <b style={{ color: "#111827" }}>{r.paid}</b></div>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>{PHASE_MEANING[p]}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Slide>

        {/* ── 국가별: 캠페인비 요약 + 월별 비용표 ── */}
        {plans.map(({ country, plan }) => (
          <div key={country} style={{ display: "grid", gap: 18 }}>
            <Slide accent={accent}>
              <Head accent={accent} kicker={`${COUNTRY_LABEL[country]} · CAMPAIGN COST`} title={`${plan.input.months}개월 캠페인비 요약`} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                <BigStat label="무가 콘텐츠 발행" value={wonMan(plan.totalOrganic)} />
                <BigStat label="유가 콘텐츠 발행" value={wonMan(plan.totalPaid)} />
                <BigStat label="GMV 광고 (예비)" value={`${wonMan(plan.gmvReserveMin)}~${wonMan(plan.gmvReserveMax)}`} sub="필요 시 집행" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 12 }}>
                <div style={{ borderRadius: 14, padding: "18px 20px", color: "#fff", background: `linear-gradient(120deg, #0b1220, ${accent})` }}>
                  <div style={{ fontSize: 12, color: "#cbd5e1" }}>{plan.input.months}개월 총 캠페인비</div>
                  <div style={{ fontSize: 30, fontWeight: 800, marginTop: 2 }}>{wonMan(plan.grandMin)} ~ {wonMan(plan.grandMax)}</div>
                  <div style={{ fontSize: 11.5, color: "#cbd5e1", marginTop: 4 }}>무가+유가 {wonMan(plan.totalCampaign)} · GMV 광고 최대 {wonMan(plan.gmvReserveMax)} 포함</div>
                </div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: "16px 18px", background: "#fff", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>운영 대행 실지불</div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{wonMan(doc.operation_fee)}<span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}> / 월</span></div>
                  <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 4 }}>+ 판매 수수료 {doc.commission_pct}% 별도</div>
                </div>
              </div>
            </Slide>

            <Slide accent={accent}>
              <Head accent={accent} kicker={`${COUNTRY_LABEL[country]} · MONTHLY PLAN`} title="월별 마케팅 비용" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#0b1220", color: "#fff" }}>
                      {["월", "무가 시딩", "유가 콘텐츠", "월 합계", "GMV 광고", "시즌"].map((h, i) => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: i === 0 || i === 5 ? "left" : "right", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.months.map((m) => {
                      const mega = m.phase === "MEGA";
                      return (
                        <tr key={m.index} style={{ background: mega ? `${accent}0d` : "#fff", borderBottom: "1px solid #eef2f6" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 800 }}>{m.calendarMonth}월
                            <span style={{ fontSize: 10, fontWeight: 700, color: PHASE_COLOR[m.phase], marginLeft: 6 }}>{m.phase}</span>
                          </td>
                          <td style={tdR}>{wonMan(m.organic)}</td>
                          <td style={tdR}>{m.paid > 0 ? wonMan(m.paid) : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                          <td style={{ ...tdR, fontWeight: 800 }}>{wonMan(m.monthTotal)}</td>
                          <td style={{ ...tdR, color: "#94a3b8", fontSize: 12 }}>{m.gmvNote}</td>
                          <td style={{ padding: "10px 12px" }}>
                            {m.event
                              ? <span style={{ display: "inline-block", background: accent, color: "#fff", fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999 }}>🏷 {m.event}</span>
                              : <span style={{ fontSize: 12, color: "#64748b" }}>{m.season}</span>}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: "#f8fafc", borderTop: `2px solid ${accent}` }}>
                      <td style={{ padding: "10px 12px", fontWeight: 800 }}>합계</td>
                      <td style={{ ...tdR, fontWeight: 800 }}>{wonMan(plan.totalOrganic)}</td>
                      <td style={{ ...tdR, fontWeight: 800 }}>{wonMan(plan.totalPaid)}</td>
                      <td style={{ ...tdR, fontWeight: 800 }}>{wonMan(plan.totalCampaign)}</td>
                      <td style={{ ...tdR, fontSize: 12, color: "#64748b" }}>{wonMan(plan.gmvReserveMin)}~{wonMan(plan.gmvReserveMax)}</td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>필요 시</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 8 }}>* 첫 달은 USP·히어로 콘텐츠 발굴을 위해 100% 무가 시딩. Mega 시즌에는 검증된 소재 중심으로 유가 비중을 확대합니다.</div>
            </Slide>
          </div>
        ))}

        {/* ── 시딩 벤치마크 ── */}
        <Slide accent={accent}>
          <Head accent={accent} kicker="BENCHMARK" title="TikTok Shop 시딩 벤치마크" sub="Beauty · 30일 기준 업계 참고 지표" />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "center" }}>
              <thead><tr style={{ background: "#0b1220", color: "#fff" }}>
                <th style={{ padding: "10px 12px", textAlign: "left" }} />
                {BENCH.cols.map((c) => <th key={c} style={{ padding: "10px 12px", fontWeight: 800 }}>{c}</th>)}
              </tr></thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid #eef2f6" }}><td style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700 }}>크리에이터 콘텐츠</td>{BENCH.content.map((v, i) => <td key={i} style={{ padding: "10px 12px", fontWeight: 700 }}>{v}</td>)}</tr>
                <tr><td style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700 }}>샵 광고비 (USD)</td>{BENCH.adspend.map((v, i) => <td key={i} style={{ padding: "10px 12px", color: accent, fontWeight: 800 }}>{v}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </Slide>

        {/* ── 구조 컨펌 STEP 01 ── */}
        <Slide accent={accent}>
          <Head accent={accent} kicker="STEP 01 · STRUCTURE CONFIRMATION" title="운영 구조 확정" sub="구조 컨펌 완료 후 본 캠페인(STEP 02)을 진행합니다." />
          <div style={{ display: "grid", gap: 10 }}>
            {CONFIRM.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px", background: "#fff" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: accent, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{c}</span>
              </div>
            ))}
          </div>
        </Slide>

        {/* ── 레퍼런스 ── */}
        {refs.length > 0 && (
          <Slide accent={accent}>
            <Head accent={accent} kicker="REFERENCE" title="크리에이터 콘텐츠 실측 레퍼런스" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14 }}>
              {refs.map((r, i) => (
                <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
                  {r.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.image_url} alt={r.creator ?? ""} style={{ width: "100%", height: 180, objectFit: "cover", display: "block", background: "#f1f5f9" }} />
                    : <div style={{ height: 180, background: `linear-gradient(135deg,#f1f5f9,${accent}18)`, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: 12 }}>@{r.creator || "creator"}</div>}
                  <div style={{ padding: 12 }}>
                    {r.creator && <div style={{ fontWeight: 800, fontSize: 13.5 }}>{r.creator}</div>}
                    {r.product && <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{r.product}</div>}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {r.gmv && <span style={{ background: accent, color: "#fff", fontSize: 12, fontWeight: 800, padding: "3px 8px", borderRadius: 8 }}>{r.gmv}</span>}
                      {r.roas && <Metric label="ROAS" value={r.roas} />}
                      {r.commission && <Metric label="수수료" value={r.commission} />}
                      {r.engagement && <Metric label="참여" value={r.engagement} />}
                    </div>
                    {r.desc && <div style={{ marginTop: 8, fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{r.desc}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Slide>
        )}

        <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 11, padding: "4px 0 12px" }}>
          본 제안서의 예산·물량 수치는 협의를 위한 제시 범위입니다. GMV 실적 예측 및 최종 견적서는 크리에이터 구성 확정 후 제출드립니다. · Powered by DINO STUDIO
        </div>
      </div>
    </div>
  );
}

// ── 슬라이드/헬퍼 ──
function Slide({ children, dark, accent, pad = 34 }: { children: React.ReactNode; dark?: boolean; accent: string; pad?: number }) {
  return (
    <section className="mp-slide" style={{ background: dark ? "#0b1220" : "#fff", borderRadius: 18, overflow: "hidden",
      boxShadow: "0 6px 24px rgba(15,23,42,.08)", border: dark ? "none" : "1px solid #e9ecf1", padding: pad, borderTop: dark ? "none" : `4px solid ${accent}` }}>
      {children}
    </section>
  );
}
function Head({ accent, kicker, title, sub }: { accent: string; kicker: string; title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: 2, fontWeight: 800, color: accent }}>{kicker}</div>
      <h2 style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 0", letterSpacing: "-0.01em" }}>{title}</h2>
      {sub && <div style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}
function GoalBox({ accent, tag, label, value }: { accent: string; tag: string; label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${accent}33`, background: `${accent}0a`, borderRadius: 14, padding: 18 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: accent }}>{tag}</div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}
function BigStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: "16px 18px", background: "#fff" }}>
      <div style={{ fontSize: 12, color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 2, letterSpacing: "-0.01em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return <span style={{ fontSize: 11.5, color: "#475569" }}><span style={{ color: "#94a3b8" }}>{label}</span> <b>{value}</b></span>;
}
function Chip({ children, tone }: { children: React.ReactNode; tone?: "onDark" }) {
  return <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999,
    background: tone === "onDark" ? "rgba(255,255,255,.12)" : "#f1f5f9", color: tone === "onDark" ? "#e2e8f0" : "#334155",
    border: tone === "onDark" ? "1px solid rgba(255,255,255,.18)" : "none" }}>{children}</span>;
}
const tdR: React.CSSProperties = { padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" };

// 강조색 대비 텍스트(밝은 accent면 어둡게) — 표지 브랜드명용.
function accentText(hex: string): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#fbbf24" : hex; // 너무 밝으면 앰버로 대체(가독성)
}
