// 마케팅 제안서 렌더(순수 — 서버 페이지·에디터 미리보기 공용). db 의존 없음.
import {
  computeBudgetPlan, wonMan, COUNTRY_CALENDAR, COUNTRY_LABEL, PHASE_RATIO, PHASE_MEANING,
  type MktCountry, type Phase,
} from "@/lib/mkt-proposal-engine";
import type { MktProposalDocRow } from "@/lib/mkt-proposal-doc";

const safeHex = (v: string | null | undefined) => (v && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : "#111111");

// 틱톡샵 시딩 벤치마크(업계 고정 상수).
const BENCH = {
  cols: ["T1", "T2", "T3", "T4", "T5", "Beyond"],
  content: ["204", "992", "2,776", "6,327", "22,470", "82,509"],
  adspend: ["$1.4K", "$14K", "$30K", "$137K", "$438K", "$4.6M"],
};

const STEPS = [
  { k: "STEP 01", t: "Seed · 시딩", d: "다양한 콘텐츠·크리에이터 테스트로 대량 콘텐츠 확보" },
  { k: "STEP 02", t: "Identify · 콘텐츠 발굴", d: "조회수·전환·판매 성과 분석으로 가능성 있는 콘텐츠 발굴" },
  { k: "STEP 03", t: "Amplify · 증액", d: "성과가 검증된 콘텐츠에만 광고비를 집중하고 유가 캠페인 확대" },
];

const PHASE_ORDER: Phase[] = ["BUILD", "GROWTH", "PEAK", "MEGA"];

export default function MktProposalView({ doc }: { doc: MktProposalDocRow }) {
  const accent = safeHex(doc.accent);
  const countries = (doc.countries?.length ? doc.countries : ["US"]).filter((c) => c in COUNTRY_CALENDAR) as MktCountry[];
  // 페이즈 비율: 기본값 위에 제안서별 오버라이드 병합.
  const ratios = { ...PHASE_RATIO } as typeof PHASE_RATIO;
  for (const p of PHASE_ORDER) {
    const o = doc.phase_ratios_json?.[p];
    if (o && Number.isFinite(o.organic) && Number.isFinite(o.paid)) ratios[p] = { organic: o.organic, paid: o.paid };
  }
  const plans = countries.map((c) => ({
    country: c,
    plan: computeBudgetPlan({
      monthlyBudget: doc.monthly_budget,
      country: c,
      startMonth: doc.start_month,
      months: doc.months,
      operationFee: doc.operation_fee,
      gmvReserveMin: doc.gmv_reserve_min,
      gmvReserveMax: doc.gmv_reserve_max,
      firstMonthSeedingOnly: doc.first_month_seeding,
      phaseRatios: ratios,
      overrides: doc.month_overrides_json ?? [],
    }),
  }));

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", background: "#fff", color: "#1a1a1a", fontSize: 14, lineHeight: 1.6 }}>
      {/* 표지 */}
      <section style={{ padding: "40px 36px", borderBottom: `3px solid ${accent}` }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: accent, fontWeight: 700 }}>TIKTOK SHOP MARKETING PROPOSAL</div>
        <h1 style={{ fontSize: 30, margin: "8px 0 4px", fontWeight: 800 }}>{doc.title || `${doc.brand_name ?? ""} 마케팅 협업 제안서`}</h1>
        {doc.subtitle && <div style={{ fontSize: 15, color: "#555" }}>{doc.subtitle}</div>}
        {doc.intro_note && <p style={{ marginTop: 12, color: "#444", whiteSpace: "pre-wrap" }}>{doc.intro_note}</p>}
      </section>

      {/* 제품(히어로) */}
      {doc.products_json?.length > 0 && (
        <Section title="제품">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
            {doc.products_json.map((p, i) => (
              <div key={i} style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
                {p.image_url && /* eslint-disable-next-line @next/next/no-img-element */ (
                  <img src={p.image_url} alt={p.name} style={{ width: "100%", height: 150, objectFit: "cover", display: "block", background: "#f5f5f5" }} />
                )}
                <div style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  {p.name_en && <div style={{ fontSize: 12, color: "#888" }}>{p.name_en}{p.volume ? ` · ${p.volume}` : ""}</div>}
                  {(p.features ?? []).filter(Boolean).length > 0 && (
                    <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 12.5, color: "#444" }}>
                      {(p.features ?? []).filter(Boolean).map((f, j) => <li key={j}>{f}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 목표·트랙 */}
      <Section title="목표 · 진행 트랙">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <GoalCard label="1ST GOAL · 1차 목표" value={doc.goal_first || "T1 기준 콘텐츠 204건 달성"} accent={accent} />
          <GoalCard label="FINAL GOAL · 최종 목표" value={doc.goal_final || "T2 진입 · 판매 기반 확립"} accent={accent} />
        </div>
      </Section>

      {/* 광고 집행 단계 */}
      <Section title="광고 집행 단계">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          {STEPS.map((s) => (
            <div key={s.k} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: accent }}>{s.k}</div>
              <div style={{ fontWeight: 700, margin: "2px 0 4px" }}>{s.t}</div>
              <div style={{ fontSize: 12.5, color: "#555" }}>{s.d}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 페이즈 모델 */}
      <Section title="시즌 페이즈 모델 (무가 : 유가)">
        <Table head={["기준", "무가 : 유가", "의미"]}
          rows={PHASE_ORDER.map((p) => [`${p}`, `${PHASE_RATIO[p].organic} : ${PHASE_RATIO[p].paid}`, PHASE_MEANING[p]])} />
        <p style={{ fontSize: 12, color: "#888", marginTop: 6 }}>첫 달은 USP·히어로 콘텐츠 발굴을 위해 100% 무가 시딩으로 시작합니다.</p>
      </Section>

      {/* 국가별 계획 */}
      {plans.map(({ country, plan }) => (
        <div key={country}>
          <Section title={`${COUNTRY_LABEL[country]} · 월별 마케팅 예산`}>
            {/* 6개월 합계 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
              <Stat label="무가 콘텐츠 발행" value={wonMan(plan.totalOrganic)} />
              <Stat label="유가 콘텐츠 발행" value={wonMan(plan.totalPaid)} />
              <Stat label="GMV 광고(예비)" value={`${wonMan(plan.gmvReserveMin)}~${wonMan(plan.gmvReserveMax)}`} sub="필요 시" />
              <Stat label={`${plan.input.months}개월 총 캠페인비`} value={`${wonMan(plan.grandMin)}~${wonMan(plan.grandMax)}`} accent={accent} />
              <Stat label="월 캠페인비 합계" value={wonMan(doc.monthly_budget)} />
              <Stat label="운영 대행 실지불" value={`${wonMan(doc.operation_fee)}/월`} sub={`+ 판매 수수료 ${doc.commission_pct}% 별도`} />
            </div>
            {/* 월별 표 */}
            <Table
              head={["월", "무가 시딩", "유가 콘텐츠", "월 합계", "GMV 광고", "시즌"]}
              rows={plan.months.map((m) => [
                `${m.calendarMonth}월`,
                wonMan(m.organic),
                m.paid > 0 ? wonMan(m.paid) : "—",
                wonMan(m.monthTotal),
                m.gmvNote,
                m.event ? `🏷️ ${m.event}` : m.season,
              ])}
              boldLastCol
            />
            <p style={{ fontSize: 11.5, color: "#888", marginTop: 6 }}>
              {plan.months[0]?.note} · 이후 각 월의 무가:유가 비중은 {COUNTRY_LABEL[country]} 시즌 페이즈에 따라 자동 조정됩니다.
            </p>
          </Section>
        </div>
      ))}

      {/* 시딩 벤치마크 */}
      <Section title="TikTok Shop 시딩 벤치마크 (Beauty · 30일)">
        <Table
          head={["", ...BENCH.cols]}
          rows={[["크리에이터 콘텐츠", ...BENCH.content], ["샵 광고비(USD)", ...BENCH.adspend]]}
        />
      </Section>

      {/* 레퍼런스 */}
      {doc.references_json?.length > 0 && (
        <Section title="레퍼런스 · 크리에이터 실측">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
            {doc.references_json.map((r, i) => (
              <div key={i} style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
                {r.image_url && /* eslint-disable-next-line @next/next/no-img-element */ (
                  <img src={r.image_url} alt={r.creator ?? ""} style={{ width: "100%", height: 160, objectFit: "cover", display: "block", background: "#f5f5f5" }} />
                )}
                <div style={{ padding: 10, fontSize: 12.5 }}>
                  {r.creator && <div style={{ fontWeight: 700 }}>{r.creator}</div>}
                  {r.product && <div style={{ color: "#888", fontSize: 11.5 }}>{r.product}</div>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6, fontSize: 11.5 }}>
                    {r.gmv && <span style={{ fontWeight: 700, color: accent }}>{r.gmv}</span>}
                    {r.roas && <span>ROAS {r.roas}</span>}
                    {r.commission && <span>수수료 {r.commission}</span>}
                    {r.engagement && <span>참여 {r.engagement}</span>}
                  </div>
                  {r.desc && <div style={{ marginTop: 6, color: "#555" }}>{r.desc}</div>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{ padding: "24px 36px", borderTop: "1px solid #eee", color: "#999", fontSize: 11 }}>
        본 제안서의 예산·물량 수치는 협의를 위한 제시 범위입니다. GMV 실적 예측 및 최종 견적서는 크리에이터 구성 확정 후 제출드립니다. · Powered by Dinostudio
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "26px 36px", borderBottom: "1px solid #f0f0f0" }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 14px" }}>{title}</h2>
      {children}
    </section>
  );
}
function GoalCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ flex: "1 1 240px", border: `1px solid ${accent}22`, background: `${accent}0a`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent }}>{label}</div>
      <div style={{ fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 15, color: accent ?? "#1a1a1a" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#aaa" }}>{sub}</div>}
    </div>
  );
}
function Table({ head, rows, boldLastCol }: { head: string[]; rows: string[][]; boldLastCol?: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>{head.map((h, i) => <th key={i} style={{ textAlign: i === 0 ? "left" : "center", padding: "7px 8px", background: "#f7f7f5", borderBottom: "1px solid #e5e5e5", fontWeight: 700 }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} style={{
                  padding: "7px 8px", borderBottom: "1px solid #f0f0f0",
                  textAlign: ci === 0 ? "left" : "center",
                  fontWeight: ci === 0 || (boldLastCol && ci === r.length - 1) ? 700 : 400,
                }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
