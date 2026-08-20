// 마케팅 제안서 렌더 — A4 가로 고정비율 슬라이드(화면=PDF 동일 레이아웃). 순수, db 의존 없음.
import {
  computeBudgetPlan, wonMan, COUNTRY_CALENDAR, COUNTRY_LABEL, PHASE_RATIO, PHASE_MEANING,
  type MktCountry, type Phase,
} from "@/lib/mkt-proposal-engine";
import type { MktProposalDocRow, MktProductItem, MktReferenceItem } from "@/lib/mkt-proposal-doc";

const safeHex = (v: string | null | undefined) => (v && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : "#111827");
const chunk = <T,>(arr: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

const BENCH = {
  cols: ["T1", "T2", "T3", "T4", "T5", "Beyond"],
  content: ["204", "992", "2,776", "6,327", "22,470", "82,509"],
  adspend: ["$1.4K", "$14K", "$30K", "$137K", "$438K", "$4.6M"],
};
const STEPS = [
  { k: "STEP 01", en: "Seed", t: "시딩", d: "다양한 콘텐츠·크리에이터를 테스트해 대량 콘텐츠를 확보합니다." },
  { k: "STEP 02", en: "Identify", t: "콘텐츠 발굴", d: "조회수·전환·판매 성과를 분석해 가능성 있는 콘텐츠를 발굴합니다." },
  { k: "STEP 03", en: "Amplify", t: "증액", d: "성과가 검증된 콘텐츠에 광고비를 집중하고 유가 캠페인을 확대합니다." },
];
const CONFIRM = ["6개월 예산 · 월별 시딩 · 라이브 운영 규모 확정", "GMV 광고 최소 집행 · 증액 기준 합의", "운영 대행 범위(물류 · CS · 발주) 확정"];
const PHASE_ORDER: Phase[] = ["BUILD", "GROWTH", "PEAK", "MEGA"];
const PHASE_COLOR: Record<Phase, string> = { BUILD: "#64748b", GROWTH: "#0ea5e9", PEAK: "#f59e0b", MEGA: "#ef4444" };

export default function MktProposalView({ doc }: { doc: MktProposalDocRow }) {
  const accent = safeHex(doc.accent);
  const brand = doc.brand_name ?? "";
  const countries = (doc.countries?.length ? doc.countries : ["US"]).filter((c) => c in COUNTRY_CALENDAR) as MktCountry[];
  const ratios = { ...PHASE_RATIO } as typeof PHASE_RATIO;
  for (const p of PHASE_ORDER) { const o = doc.phase_ratios_json?.[p]; if (o && Number.isFinite(o.organic) && Number.isFinite(o.paid)) ratios[p] = { organic: o.organic, paid: o.paid }; }
  const plans = countries.map((c) => ({ country: c, plan: computeBudgetPlan({
    monthlyBudget: doc.monthly_budget, country: c, startMonth: doc.start_month, months: doc.months,
    operationFee: doc.operation_fee, gmvReserveMin: doc.gmv_reserve_min, gmvReserveMax: doc.gmv_reserve_max,
    firstMonthSeedingOnly: doc.first_month_seeding, phaseRatios: ratios, overrides: doc.month_overrides_json ?? [],
  }) }));
  const products = (doc.products_json ?? []).filter((p) => p.name || p.image_url);
  const refs = (doc.references_json ?? []).filter((r) => r.creator || r.product || r.image_url || r.gmv);
  const title = doc.title || `${brand} 마케팅 협업 제안서`;

  return (
    <div style={{ background: "#e9ebef", padding: "16px 12px" }}>
      <style>{`
        .mp-deck { --slide-w: 1000px; }
        .mp-slide { width: 100%; aspect-ratio: 297 / 210; overflow: hidden; position: relative;
          background:#fff; border-radius:14px; box-shadow:0 6px 22px rgba(15,23,42,.10); }
        @media print {
          @page { size: A4 landscape; margin: 0; }
          html, body { background:#fff !important; }
          .mp-noprint { display:none !important; }
          .mp-deck { --slide-w: 297mm; gap: 0 !important; }
          .mp-slide { width: 297mm; height: 210mm; aspect-ratio: auto; border-radius: 0; box-shadow: none;
            page-break-after: always; break-after: page; }
        }
      `}</style>
      <div className="mp-deck" style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 16 }}>

        {/* 표지 */}
        <Slide>
          <div style={{ position: "absolute", inset: 0, background: `radial-gradient(900px 340px at 88% -10%, ${accent}55, transparent), linear-gradient(135deg,#0b1220 0%,#111827 55%,${accent}22 100%)` }} />
          <Pad style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", color: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: "1.1em", letterSpacing: 3, color: "#cbd5e1", fontWeight: 700 }}>TIKTOK SHOP · MARKETING PROPOSAL</div>
              <div style={{ fontWeight: 800, letterSpacing: 1, fontSize: "1.2em", textAlign: "right", lineHeight: 1.15 }}>DINO<br />STUDIO</div>
            </div>
            <div>
              {brand && <div style={{ color: "#fbbf24", fontWeight: 800, fontSize: "1.35em", marginBottom: 10, letterSpacing: 1 }}>{brand.toUpperCase()}</div>}
              <h1 style={{ fontSize: "3.6em", fontWeight: 800, margin: 0, lineHeight: 1.12, letterSpacing: "-0.02em" }}>{title}</h1>
              {doc.subtitle && <div style={{ color: "#cbd5e1", fontSize: "1.6em", marginTop: 12 }}>{doc.subtitle}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {countries.map((c) => <Chip key={c} dark>{COUNTRY_LABEL[c]}</Chip>)}
              <Chip dark>{doc.months}개월 캠페인</Chip>
              <Chip dark>월 예산 {wonMan(doc.monthly_budget)}</Chip>
            </div>
          </Pad>
        </Slide>

        {/* 제품 (3개/슬라이드) */}
        {chunk(products, 3).map((grp, gi) => (
          <Slide key={`prod-${gi}`} accent={accent}>
            <Pad>
              <Head accent={accent} kicker="PRODUCT" title={`핵심 SKU${chunk(products, 3).length > 1 ? ` (${gi + 1})` : ""}`} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18, marginTop: 18 }}>
                {grp.map((p, i) => <ProductCard key={i} p={p} n={gi * 3 + i + 1} accent={accent} />)}
              </div>
            </Pad>
          </Slide>
        ))}

        {/* 목표 · 트랙 · 집행단계 */}
        <Slide accent={accent}>
          <Pad>
            <Head accent={accent} kicker="GOAL & PROCESS" title="목표 · 진행 트랙 · 광고 집행 단계" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, margin: "18px 0 22px" }}>
              <GoalBox accent={accent} tag="1ST GOAL" label="1차 목표" value={doc.goal_first || "T1 기준 콘텐츠 204건 달성"} />
              <GoalBox accent={accent} tag="FINAL GOAL" label="최종 목표" value={doc.goal_final || "T2 진입 · 판매 기반 확립"} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
              {STEPS.map((s, i) => (
                <div key={s.k} style={{ position: "relative", border: "1px solid #e5e7eb", borderRadius: 14, padding: "18px 18px", background: "#fff" }}>
                  <div style={{ position: "absolute", top: 12, right: 16, fontSize: "3.2em", fontWeight: 800, color: `${accent}22` }}>{String(i + 1).padStart(2, "0")}</div>
                  <div style={{ fontSize: "0.95em", fontWeight: 800, letterSpacing: 1, color: accent }}>{s.k}</div>
                  <div style={{ fontWeight: 800, fontSize: "1.35em", marginTop: 4 }}>{s.en} <span style={{ color: "#64748b", fontWeight: 700, fontSize: "0.75em" }}>· {s.t}</span></div>
                  <div style={{ fontSize: "1.02em", color: "#475569", marginTop: 10, lineHeight: 1.55 }}>{s.d}</div>
                </div>
              ))}
            </div>
          </Pad>
        </Slide>

        {/* 시즌 페이즈 모델 */}
        <Slide accent={accent}>
          <Pad>
            <Head accent={accent} kicker="SEASON PHASE MODEL" title="BUILD → GROWTH → PEAK → MEGA" sub="시즌 단계에 따라 무가:유가 비중을 자동 조정합니다. 첫 달은 100% 무가 시딩으로 시작합니다." />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginTop: 20 }}>
              {PHASE_ORDER.map((p) => { const r = ratios[p]; const tot = (r.organic + r.paid) || 1; return (
                <div key={p} style={{ border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
                  <div style={{ background: PHASE_COLOR[p], color: "#fff", padding: "12px 16px", fontWeight: 800, letterSpacing: 1, display: "flex", justifyContent: "space-between", fontSize: "1.1em" }}><span>{p}</span><span>{r.organic}:{r.paid}</span></div>
                  <div style={{ padding: 16 }}>
                    <div style={{ display: "flex", height: 9, borderRadius: 5, overflow: "hidden", marginBottom: 10 }}><div style={{ width: `${(r.organic / tot) * 100}%`, background: PHASE_COLOR[p] }} /><div style={{ width: `${(r.paid / tot) * 100}%`, background: "#e2e8f0" }} /></div>
                    <div style={{ fontSize: "0.95em", color: "#64748b" }}>무가 <b style={{ color: "#111827" }}>{r.organic}</b> · 유가 <b style={{ color: "#111827" }}>{r.paid}</b></div>
                    <div style={{ fontSize: "1em", color: "#475569", marginTop: 10, lineHeight: 1.5 }}>{PHASE_MEANING[p]}</div>
                  </div>
                </div>
              ); })}
            </div>
          </Pad>
        </Slide>

        {/* 국가별: 요약 + 월별표 */}
        {plans.map(({ country, plan }) => [
          <Slide key={`sum-${country}`} accent={accent}>
            <Pad>
              <Head accent={accent} kicker={`${COUNTRY_LABEL[country]} · CAMPAIGN COST`} title={`${plan.input.months}개월 캠페인비 요약`} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 18 }}>
                <BigStat label="무가 콘텐츠 발행" value={wonMan(plan.totalOrganic)} />
                <BigStat label="유가 콘텐츠 발행" value={wonMan(plan.totalPaid)} />
                <BigStat label="GMV 광고 (예비)" value={`${wonMan(plan.gmvReserveMin)}~${wonMan(plan.gmvReserveMax)}`} sub="필요 시 집행" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 14, marginTop: 16 }}>
                <div style={{ borderRadius: 16, padding: "24px 26px", color: "#fff", background: `linear-gradient(120deg,#0b1220,${accent})` }}>
                  <div style={{ fontSize: "1.05em", color: "#cbd5e1" }}>{plan.input.months}개월 총 캠페인비</div>
                  <div style={{ fontSize: "2.6em", fontWeight: 800, marginTop: 4, lineHeight: 1.1 }}>{wonMan(plan.grandMin)} ~ {wonMan(plan.grandMax)}</div>
                  <div style={{ fontSize: "0.95em", color: "#cbd5e1", marginTop: 6 }}>무가+유가 {wonMan(plan.totalCampaign)} · GMV 광고 최대 {wonMan(plan.gmvReserveMax)} 포함</div>
                </div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: "20px 22px", background: "#fff", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ fontSize: "1em", color: "#64748b" }}>운영 대행 실지불</div>
                  <div style={{ fontSize: "2em", fontWeight: 800 }}>{wonMan(doc.operation_fee)}<span style={{ fontSize: "0.55em", fontWeight: 600, color: "#64748b" }}> / 월</span></div>
                  <div style={{ fontSize: "0.9em", color: "#94a3b8", marginTop: 4 }}>+ 판매 수수료 {doc.commission_pct}% 별도</div>
                </div>
              </div>
            </Pad>
          </Slide>,
          <Slide key={`tbl-${country}`} accent={accent}>
            <Pad>
              <Head accent={accent} kicker={`${COUNTRY_LABEL[country]} · MONTHLY PLAN`} title="월별 마케팅 비용" />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "1.02em", marginTop: 14 }}>
                <thead><tr style={{ background: "#0b1220", color: "#fff" }}>
                  {["월", "무가 시딩", "유가 콘텐츠", "월 합계", "GMV 광고", "시즌"].map((h, i) => <th key={h} style={{ padding: "9px 12px", textAlign: i === 0 || i === 5 ? "left" : "right", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {plan.months.map((m) => { const mega = m.phase === "MEGA"; return (
                    <tr key={m.index} style={{ background: mega ? `${accent}0d` : "#fff", borderBottom: "1px solid #eef2f6" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 800 }}>{m.calendarMonth}월<span style={{ fontSize: "0.72em", fontWeight: 700, color: PHASE_COLOR[m.phase], marginLeft: 6 }}>{m.phase}</span></td>
                      <td style={tdR}>{wonMan(m.organic)}</td>
                      <td style={tdR}>{m.paid > 0 ? wonMan(m.paid) : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ ...tdR, fontWeight: 800 }}>{wonMan(m.monthTotal)}</td>
                      <td style={{ ...tdR, color: "#94a3b8", fontSize: "0.85em" }}>{m.gmvNote}</td>
                      <td style={{ padding: "8px 12px" }}>{m.event ? <span style={{ display: "inline-block", background: accent, color: "#fff", fontSize: "0.78em", fontWeight: 800, padding: "3px 9px", borderRadius: 999 }}>🏷 {m.event}</span> : <span style={{ fontSize: "0.85em", color: "#64748b" }}>{m.season}</span>}</td>
                    </tr>
                  ); })}
                  <tr style={{ background: "#f8fafc", borderTop: `2px solid ${accent}` }}>
                    <td style={{ padding: "9px 12px", fontWeight: 800 }}>합계</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{wonMan(plan.totalOrganic)}</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{wonMan(plan.totalPaid)}</td>
                    <td style={{ ...tdR, fontWeight: 800 }}>{wonMan(plan.totalCampaign)}</td>
                    <td style={{ ...tdR, fontSize: "0.85em", color: "#64748b" }}>{wonMan(plan.gmvReserveMin)}~{wonMan(plan.gmvReserveMax)}</td>
                    <td style={{ padding: "9px 12px", fontSize: "0.85em", color: "#64748b" }}>필요 시</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ fontSize: "0.85em", color: "#94a3b8", marginTop: 10 }}>* 첫 달은 USP·히어로 콘텐츠 발굴을 위해 100% 무가 시딩. Mega 시즌에는 검증된 소재 중심으로 유가 비중을 확대합니다.</div>
            </Pad>
          </Slide>,
        ])}

        {/* 벤치마크 + 구조 컨펌 (1슬라이드 2단) */}
        <Slide accent={accent}>
          <Pad>
            <Head accent={accent} kicker="BENCHMARK & STRUCTURE" title="시딩 벤치마크 · 운영 구조 확정" />
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: "0.95em", color: "#64748b", fontWeight: 700, marginBottom: 8 }}>TikTok Shop 시딩 벤치마크 (Beauty · 30일)</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "1em", textAlign: "center" }}>
                <thead><tr style={{ background: "#0b1220", color: "#fff" }}><th style={{ padding: "8px 12px", textAlign: "left" }} />{BENCH.cols.map((c) => <th key={c} style={{ padding: "8px 12px", fontWeight: 800 }}>{c}</th>)}</tr></thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #eef2f6" }}><td style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>크리에이터 콘텐츠</td>{BENCH.content.map((v, i) => <td key={i} style={{ padding: "8px 12px", fontWeight: 700 }}>{v}</td>)}</tr>
                  <tr><td style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>샵 광고비 (USD)</td>{BENCH.adspend.map((v, i) => <td key={i} style={{ padding: "8px 12px", color: accent, fontWeight: 800 }}>{v}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: "0.95em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>STEP 01 · 운영 구조 확정 (컨펌 후 본 캠페인 진행)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {CONFIRM.map((c, i) => (
                  <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px", background: "#fff", display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: accent, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: "0.85em", flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: "0.98em", fontWeight: 600, lineHeight: 1.4 }}>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          </Pad>
        </Slide>

        {/* 레퍼런스 (8개/슬라이드 = 4×2) */}
        {chunk(refs, 8).map((grp, gi) => (
          <Slide key={`ref-${gi}`} accent={accent}>
            <Pad>
              <Head accent={accent} kicker="REFERENCE" title={`크리에이터 콘텐츠 실측 레퍼런스${chunk(refs, 8).length > 1 ? ` (${gi + 1})` : ""}`} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gridTemplateRows: "1fr 1fr", gap: 12, marginTop: 14, height: "calc(100% - 80px)" }}>
                {grp.map((r, i) => <RefCard key={i} r={r} accent={accent} />)}
              </div>
            </Pad>
          </Slide>
        ))}
      </div>
    </div>
  );
}

// ── 슬라이드/헬퍼 (em 기반 → 화면/PDF 스케일 일치) ──
function Slide({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return <section className="mp-slide" style={{ fontSize: "calc(var(--slide-w) / 78)", borderTop: accent ? `4px solid ${accent}` : undefined }}>{children}</section>;
}
function Pad({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ padding: "3.2% 4%", height: "100%", boxSizing: "border-box", ...style }}>{children}</div>;
}
function Head({ accent, kicker, title, sub }: { accent: string; kicker: string; title: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.92em", letterSpacing: 2, fontWeight: 800, color: accent }}>{kicker}</div>
      <h2 style={{ fontSize: "2.05em", fontWeight: 800, margin: "4px 0 0", letterSpacing: "-0.01em", color: "#111827" }}>{title}</h2>
      {sub && <div style={{ fontSize: "1.02em", color: "#64748b", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}
function ProductCard({ p, n, accent }: { p: MktProductItem; n: number; accent: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column" }}>
      {p.image_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.image_url} alt={p.name} style={{ width: "100%", height: "9.5em", objectFit: "cover", display: "block", background: "#f1f5f9" }} />
        : <div style={{ height: "9.5em", background: `linear-gradient(135deg,#f1f5f9,${accent}18)`, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: "0.9em" }}>이미지 없음</div>}
      <div style={{ padding: "1em 1.1em" }}>
        <div style={{ fontSize: "0.9em", fontWeight: 800, color: accent }}>{String(n).padStart(2, "0")}</div>
        <div style={{ fontWeight: 800, fontSize: "1.2em", marginTop: 2 }}>{p.name}</div>
        {(p.name_en || p.volume) && <div style={{ fontSize: "0.9em", color: "#94a3b8" }}>{[p.name_en, p.volume].filter(Boolean).join(" · ")}</div>}
        {(p.features ?? []).filter(Boolean).length > 0 && (
          <ul style={{ margin: "0.7em 0 0", padding: 0, listStyle: "none", display: "grid", gap: 5 }}>
            {(p.features ?? []).filter(Boolean).slice(0, 3).map((f, j) => <li key={j} style={{ fontSize: "0.92em", color: "#374151", display: "flex", gap: 6 }}><span style={{ color: accent, fontWeight: 800 }}>·</span><span>{f}</span></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
function RefCard({ r, accent }: { r: MktReferenceItem; accent: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {r.image_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={r.image_url} alt={r.creator ?? ""} style={{ width: "100%", flex: 1, objectFit: "cover", display: "block", background: "#f1f5f9", minHeight: 0 }} />
        : <div style={{ flex: 1, background: `linear-gradient(135deg,#f1f5f9,${accent}18)`, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: "0.85em" }}>@{r.creator || "creator"}</div>}
      <div style={{ padding: "0.7em 0.8em" }}>
        {r.creator && <div style={{ fontWeight: 800, fontSize: "0.92em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.creator}</div>}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
          {r.gmv && <span style={{ background: accent, color: "#fff", fontSize: "0.82em", fontWeight: 800, padding: "2px 7px", borderRadius: 7 }}>{r.gmv}</span>}
          {r.roas && <span style={{ fontSize: "0.8em", color: "#475569" }}>ROAS <b>{r.roas}</b></span>}
        </div>
      </div>
    </div>
  );
}
function GoalBox({ accent, tag, label, value }: { accent: string; tag: string; label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${accent}33`, background: `${accent}0a`, borderRadius: 14, padding: "18px 20px" }}>
      <div style={{ fontSize: "0.92em", fontWeight: 800, letterSpacing: 1, color: accent }}>{tag}</div>
      <div style={{ fontSize: "0.95em", color: "#94a3b8", marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: "1.5em", fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}
function BigStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: "16px 18px", background: "#fff" }}>
      <div style={{ fontSize: "0.95em", color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: "1.9em", fontWeight: 800, marginTop: 2, letterSpacing: "-0.01em" }}>{value}</div>
      {sub && <div style={{ fontSize: "0.82em", color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Chip({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return <span style={{ fontSize: "0.95em", fontWeight: 700, padding: "6px 13px", borderRadius: 999, background: dark ? "rgba(255,255,255,.12)" : "#f1f5f9", color: dark ? "#e2e8f0" : "#334155", border: dark ? "1px solid rgba(255,255,255,.18)" : "none" }}>{children}</span>;
}
const tdR: React.CSSProperties = { padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" };
