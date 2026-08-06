"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProposalDocAction, deleteProposalDocAction } from "../actions";
import type { ProposalDoc, ProposalProduct, ProposalCreator, ProposalFeature, ProposalValueItem, ProposalStep, ProposalImpact, ProposalAddon } from "@/lib/proposal-doc";

const TRACKS: [string, string][] = [["onboarding", "온보딩"], ["mall", "멀티몰"], ["marketing", "마케팅"]];

// 숫자 파싱 — 빈값이면 null.
const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, "")) || 0);

export default function ProposalEditor({ doc, publicBase }: { doc: ProposalDoc; publicBase: string }) {
  const router = useRouter();
  const [d, setD] = useState<ProposalDoc>(doc);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = <K extends keyof ProposalDoc>(k: K, v: ProposalDoc[K]) => setD((p) => ({ ...p, [k]: v }));
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const publicUrl = `${publicBase}/proposal/${d.token}`;

  async function save(publish?: boolean) {
    setBusy(true);
    const r = await saveProposalDocAction({
      id: d.id, title: d.title, subtitle: d.subtitle, brand_name: d.brand_name, brand_logo_url: d.brand_logo_url,
      track: d.track, list_amount: d.list_amount, monthly_amount: d.monthly_amount, fee_pct: d.fee_pct,
      term_months: d.term_months, term_discount_pct: d.track === "onboarding" ? null : d.term_discount_pct, features: d.features,
      seeding_qty: d.seeding_qty, live_qty: d.live_qty, op_tags: d.op_tags,
      kpi_tier: d.kpi_tier, kpi_stage: d.kpi_stage, kpi_creator_content: d.kpi_creator_content, kpi_ad_spend: d.kpi_ad_spend,
      products: d.products, creators: d.creators, accent: d.accent,
      product_en: d.product_en, product_volume: d.product_volume, product_features: d.product_features, product_tags: d.product_tags,
      value_items: d.value_items, value_total: d.value_total,
      roadmap_steps: d.roadmap_steps, impacts: d.impacts, impact_banner: d.impact_banner,
      kpi_year_tier: d.kpi_year_tier, kpi_year_stage: d.kpi_year_stage, kpi_year_creator_content: d.kpi_year_creator_content, kpi_year_ad_spend: d.kpi_year_ad_spend,
      addons: d.addons,
      status: publish === undefined ? d.status : publish ? "published" : "draft",
    });
    setBusy(false);
    if (r.ok) { if (publish !== undefined) set("status", publish ? "published" : "draft"); flash(publish ? "발행되었습니다." : "저장되었습니다."); router.refresh(); }
    else flash(r.error ?? "저장 실패");
  }
  async function remove() {
    if (!confirm("이 제안서를 삭제할까요?")) return;
    await deleteProposalDocAction(d.id); router.push("/proposal-docs");
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 상단 액션 */}
      <div className="card" style={{ padding: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: d.status === "published" ? "#12b886" : "#f0a02c", fontWeight: 700 }}>
          {d.status === "published" ? "● 발행됨" : "○ 초안"}
        </span>
        <a className="btn sm" href={publicUrl} target="_blank">미리보기 ↗</a>
        <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(publicUrl); flash("공개 링크 복사됨"); }}>공개링크 복사</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn sm" disabled={busy} onClick={() => save()}>저장</button>
          {d.status === "published"
            ? <button className="btn sm" disabled={busy} onClick={() => save(false)}>발행 취소</button>
            : <button className="btn sm primary" disabled={busy} onClick={() => save(true)}>저장 &amp; 발행</button>}
          <button className="btn sm" onClick={remove} style={{ color: "#e03131" }}>삭제</button>
        </div>
      </div>

      {/* 표지 · 브랜드 */}
      <Card title="표지 · 브랜드">
        <Grid>
          <F label="제목" v={d.title} on={(v) => set("title", v)} full />
          <F label="부제" v={d.subtitle} on={(v) => set("subtitle", v)} full />
          <F label="브랜드명" v={d.brand_name} on={(v) => set("brand_name", v)} />
          <Sel label="트랙" v={d.track} opts={TRACKS} on={(v) => set("track", v)} />
          <F label="브랜드 로고 URL" v={d.brand_logo_url ?? ""} on={(v) => set("brand_logo_url", v || null)} />
          <F label="강조색(브랜드 오버라이드, 예: #1f7a4d)" v={d.accent ?? ""} on={(v) => set("accent", v || null)} placeholder="비우면 템플릿 기본색" />
        </Grid>
      </Card>

      {/* 가격 조건 */}
      <Card title="가격 조건">
        <Grid>
          <F label="정가(list, 원)" v={d.list_amount?.toString() ?? ""} on={(v) => set("list_amount", numOrNull(v))} />
          <F label="월 금액(원)" v={d.monthly_amount?.toString() ?? ""} on={(v) => set("monthly_amount", numOrNull(v))} />
          <F label="판매 수수료(%)" v={d.fee_pct?.toString() ?? ""} on={(v) => set("fee_pct", numOrNull(v))} />
          <F label="약정 개월" v={d.term_months?.toString() ?? ""} on={(v) => set("term_months", numOrNull(v))} />
          {/* 온보딩 트랙은 국가당 픽스가 → 6개월 약정 할인 없음(회의 확정). 마케팅/멀티몰만 노출. */}
          {d.track !== "onboarding"
            ? <F label="약정 추가할인(%)" v={d.term_discount_pct?.toString() ?? ""} on={(v) => set("term_discount_pct", numOrNull(v))} />
            : <div style={{ fontSize: 11, color: "var(--ink3)", alignSelf: "end", paddingBottom: 6 }}>온보딩 트랙은 약정 할인 없음(픽스가)</div>}
        </Grid>
        <ListEditor label="기능 체크리스트 (한 줄에 하나)" items={d.features} on={(v) => set("features", v)} placeholder="예: 크리에이터 시딩 20건 · 라이브 4건" />
      </Card>

      {/* 운영 · 콘텐츠 */}
      <Card title="운영 · 콘텐츠">
        <Grid>
          <F label="무가 시딩 수량(건)" v={d.seeding_qty?.toString() ?? ""} on={(v) => set("seeding_qty", numOrNull(v))} />
          <F label="라이브 수량(건)" v={d.live_qty?.toString() ?? ""} on={(v) => set("live_qty", numOrNull(v))} />
        </Grid>
        <ListEditor label="운영 태그 (한 줄에 하나, # 제외)" items={d.op_tags} on={(v) => set("op_tags", v)} placeholder="예: 콘텐츠기획" />
      </Card>

      {/* KPI */}
      <Card title="KPI 로드맵 (6개월 · 1년)">
        <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 700, margin: "0 0 6px" }}>6개월 KPI</div>
        <Grid>
          <F label="티어(예: T1)" v={d.kpi_tier ?? ""} on={(v) => set("kpi_tier", v || null)} />
          <F label="단계 설명" v={d.kpi_stage ?? ""} on={(v) => set("kpi_stage", v || null)} />
          <F label="크리에이터 콘텐츠 수" v={d.kpi_creator_content?.toString() ?? ""} on={(v) => set("kpi_creator_content", numOrNull(v))} />
          <F label="샵 광고비(참고, 예: $1.4K)" v={d.kpi_ad_spend ?? ""} on={(v) => set("kpi_ad_spend", v || null)} />
        </Grid>
        <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 700, margin: "14px 0 6px" }}>1년 KPI</div>
        <Grid>
          <F label="티어(예: T2)" v={d.kpi_year_tier ?? ""} on={(v) => set("kpi_year_tier", v || null)} />
          <F label="단계 설명" v={d.kpi_year_stage ?? ""} on={(v) => set("kpi_year_stage", v || null)} />
          <F label="크리에이터 콘텐츠 수" v={d.kpi_year_creator_content?.toString() ?? ""} on={(v) => set("kpi_year_creator_content", numOrNull(v))} />
          <F label="샵 광고비(참고, 예: $14K)" v={d.kpi_year_ad_spend ?? ""} on={(v) => set("kpi_year_ad_spend", v || null)} />
        </Grid>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 10 }}>· 벤치마크 표(T1~Beyond)와 하단 주석은 업계 고정값으로 자동 표기됩니다.</div>
      </Card>

      {/* 핵심 SKU (히어로 제품) */}
      <Card title="핵심 SKU (표지 다음 제품 섹션)">
        <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 8 }}>제품 이미지·이름은 아래 &lt;제품 레퍼런스&gt;의 첫 제품을 사용합니다. 여기서는 상세 정보만 추가합니다.</div>
        <Grid>
          <F label="영문명(예: Bollabo Finish Wrapping Gel)" v={d.product_en ?? ""} on={(v) => set("product_en", v || null)} />
          <F label="용량/규격(예: 50ml)" v={d.product_volume ?? ""} on={(v) => set("product_volume", v || null)} />
        </Grid>
        <TitleDescEditor label="특징 카드 (제목 + 설명)" items={d.product_features} on={(v) => set("product_features", v)} ph="제목(예: 밤 사이 유효성분 잠금)" ph2="설명" />
        <ListEditor label="해시태그 (한 줄에 하나, # 제외)" items={d.product_tags} on={(v) => set("product_tags", v)} placeholder="예: 나이트랩핑" />
      </Card>

      {/* 제품 레퍼런스 */}
      <Card title={`제품 레퍼런스 (${d.products.length})`}>
        <ProductsEditor items={d.products} on={(v) => set("products", v)} />
      </Card>

      {/* 상당 구성 가치 */}
      <Card title={`상당 구성 가치 명세 (${d.value_items.length})`}>
        <ValueItemsEditor items={d.value_items} on={(v) => set("value_items", v)} />
        <div style={{ marginTop: 10, maxWidth: 260 }}>
          <F label="합계(상당, 원)" v={d.value_total?.toString() ?? ""} on={(v) => set("value_total", numOrNull(v))} />
        </div>
      </Card>

      {/* 실행 로드맵 */}
      <Card title={`실행 로드맵 STEP (${d.roadmap_steps.length})`}>
        <TitleDescEditor label="" items={d.roadmap_steps} on={(v) => set("roadmap_steps", v)} ph="단계명(예: 온보딩 세팅)" ph2="설명(예: 인증·물류·번역·스토어 세팅)" addLabel="+ STEP 추가" />
      </Card>

      {/* 기대 효과 */}
      <Card title={`기대 효과 (${d.impacts.length})`}>
        <TitleDescEditor label="" items={d.impacts} on={(v) => set("impacts", v)} ph="제목(예: 초기 GMV 확보)" ph2="설명" addLabel="+ 기대효과 추가" />
        <div style={{ marginTop: 10 }}>
          <F label="하단 배너 문구" v={d.impact_banner ?? ""} on={(v) => set("impact_banner", v || null)} full placeholder="예: 월 200만원으로 틱톡샵 진출을 시작하세요." />
        </div>
      </Card>

      {/* 별도 제안(애드온) */}
      <Card title={`별도 제안 예정 항목 (${d.addons.length})`}>
        <AddonsEditor items={d.addons} on={(v) => set("addons", v)} />
      </Card>

      {/* 크리에이터 레퍼런스 */}
      <Card title={`크리에이터 콘텐츠 레퍼런스 (${d.creators.length})`}>
        <CreatorsEditor items={d.creators} on={(v) => set("creators", v)} />
      </Card>

      {msg && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13, zIndex: 50 }}>{msg}</div>}
    </div>
  );
}

// ── 제품 편집 ──
function ProductsEditor({ items, on }: { items: ProposalProduct[]; on: (v: ProposalProduct[]) => void }) {
  const upd = (i: number, patch: Partial<ProposalProduct>) => on(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.map((p, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.5fr 1.5fr auto", gap: 6, alignItems: "center" }}>
          <input className="f" value={p.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="제품명" />
          <input className="f" value={p.image_url ?? ""} onChange={(e) => upd(i, { image_url: e.target.value })} placeholder="이미지 URL" />
          <input className="f" value={p.desc ?? ""} onChange={(e) => upd(i, { desc: e.target.value })} placeholder="설명" />
          <button className="btn sm" onClick={() => on(items.filter((_, j) => j !== i))} style={{ color: "#e03131" }}>✕</button>
        </div>
      ))}
      <button className="btn sm" onClick={() => on([...items, { name: "" }])} style={{ justifySelf: "start" }}>+ 제품 추가</button>
    </div>
  );
}

// ── 크리에이터 편집 ──
function CreatorsEditor({ items, on }: { items: ProposalCreator[]; on: (v: ProposalCreator[]) => void }) {
  const upd = (i: number, patch: Partial<ProposalCreator>) => on(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {items.map((c, i) => (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 12 }}>크리에이터 {i + 1}</b>
            <button className="btn sm" onClick={() => on(items.filter((_, j) => j !== i))} style={{ color: "#e03131" }}>✕ 삭제</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <input className="f" value={c.handle} onChange={(e) => upd(i, { handle: e.target.value })} placeholder="@핸들" />
            <input className="f" value={c.brand ?? ""} onChange={(e) => upd(i, { brand: e.target.value })} placeholder="브랜드(배지, 예: Mediheal)" />
            <input className="f" value={c.product ?? ""} onChange={(e) => upd(i, { product: e.target.value })} placeholder="협업 제품" />
            <input className="f" value={c.thumb_url ?? ""} onChange={(e) => upd(i, { thumb_url: e.target.value })} placeholder="썸네일 URL" />
            <input className="f" value={c.revenue ?? ""} onChange={(e) => upd(i, { revenue: e.target.value })} placeholder="매출(예: ₩12,000,000)" />
            <input className="f" value={c.roas ?? ""} onChange={(e) => upd(i, { roas: e.target.value })} placeholder="ROAS(예: 4.2x)" />
            <input className="f" value={c.fee_rate ?? ""} onChange={(e) => upd(i, { fee_rate: e.target.value })} placeholder="수수료율(예: 15%)" />
            <input className="f" value={c.engagement ?? ""} onChange={(e) => upd(i, { engagement: e.target.value })} placeholder="인게이지먼트(예: 8.5%)" />
            <input className="f" value={c.caption ?? ""} onChange={(e) => upd(i, { caption: e.target.value })} placeholder="캡션/메모" style={{ gridColumn: "span 2" }} />
          </div>
        </div>
      ))}
      <button className="btn sm" onClick={() => on([...items, { handle: "" }])} style={{ justifySelf: "start" }}>+ 크리에이터 추가</button>
    </div>
  );
}

// ── 제목+설명 리스트(특징 카드 · 로드맵 STEP · 기대효과 공용) ──
function TitleDescEditor<T extends { title: string; desc?: string }>({ label, items, on, ph, ph2, addLabel }: { label: string; items: T[]; on: (v: T[]) => void; ph: string; ph2: string; addLabel?: string }) {
  const upd = (i: number, patch: Partial<T>) => on(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div style={{ display: "grid", gap: 8, marginTop: label ? 12 : 0 }}>
      {label && <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>{label}</div>}
      {items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr auto", gap: 6, alignItems: "center" }}>
          <input className="f" value={it.title} onChange={(e) => upd(i, { title: e.target.value } as Partial<T>)} placeholder={ph} />
          <input className="f" value={it.desc ?? ""} onChange={(e) => upd(i, { desc: e.target.value } as Partial<T>)} placeholder={ph2} />
          <button className="btn sm" onClick={() => on(items.filter((_, j) => j !== i))} style={{ color: "#e03131" }}>✕</button>
        </div>
      ))}
      <button className="btn sm" onClick={() => on([...items, { title: "", desc: "" } as T])} style={{ justifySelf: "start" }}>{addLabel ?? "+ 추가"}</button>
    </div>
  );
}

// ── 상당 구성 가치(라벨 · 수량 · 금액) ──
function ValueItemsEditor({ items, on }: { items: ProposalValueItem[]; on: (v: ProposalValueItem[]) => void }) {
  const upd = (i: number, patch: Partial<ProposalValueItem>) => on(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const num = (v: string) => Number(v.replace(/[^0-9]/g, "")) || 0;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr 1fr auto", gap: 6, fontSize: 11, color: "var(--ink3)" }}>
        <span>항목</span><span>수량/비고</span><span>금액(원)</span><span />
      </div>
      {items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr 1fr auto", gap: 6, alignItems: "center" }}>
          <input className="f" value={it.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="예: 시딩" />
          <input className="f" value={it.qty ?? ""} onChange={(e) => upd(i, { qty: e.target.value })} placeholder="예: 20건 × 3만" />
          <input className="f" value={it.amount ? String(it.amount) : ""} onChange={(e) => upd(i, { amount: num(e.target.value) })} placeholder="600000" />
          <button className="btn sm" onClick={() => on(items.filter((_, j) => j !== i))} style={{ color: "#e03131" }}>✕</button>
        </div>
      ))}
      <button className="btn sm" onClick={() => on([...items, { label: "", amount: 0 }])} style={{ justifySelf: "start" }}>+ 항목 추가</button>
    </div>
  );
}

// ── 별도 제안(라벨 · 제목 · 설명) ──
function AddonsEditor({ items, on }: { items: ProposalAddon[]; on: (v: ProposalAddon[]) => void }) {
  const upd = (i: number, patch: Partial<ProposalAddon>) => on(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {items.map((a, i) => (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 12 }}>항목 {i + 1}</b>
            <button className="btn sm" onClick={() => on(items.filter((_, j) => j !== i))} style={{ color: "#e03131" }}>✕ 삭제</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 6 }}>
            <input className="f" value={a.label ?? ""} onChange={(e) => upd(i, { label: e.target.value })} placeholder="영문 라벨(예: PERFORMANCE ADS)" />
            <input className="f" value={a.title} onChange={(e) => upd(i, { title: e.target.value })} placeholder="제목(예: GMV 광고 (Ads))" />
          </div>
          <textarea className="f" value={a.desc ?? ""} onChange={(e) => upd(i, { desc: e.target.value })} rows={2} placeholder="설명" style={{ resize: "vertical" }} />
        </div>
      ))}
      <button className="btn sm" onClick={() => on([...items, { title: "" }])} style={{ justifySelf: "start" }}>+ 별도 제안 추가</button>
    </div>
  );
}

// ── 공통 UI ──
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card" style={{ padding: 16 }}><b style={{ display: "block", marginBottom: 12 }}>{title}</b>{children}</div>;
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>{children}</div>;
}
function F({ label, v, on, full, placeholder }: { label: string; v: string; on: (v: string) => void; full?: boolean; placeholder?: string }) {
  return (
    <label style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600, display: "block", gridColumn: full ? "1 / -1" : undefined }}>
      {label}
      <input className="f" value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder} style={{ marginTop: 4, width: "100%", boxSizing: "border-box" }} />
    </label>
  );
}
function Sel({ label, v, opts, on }: { label: string; v: string; opts: [string, string][]; on: (v: string) => void }) {
  return (
    <label style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600, display: "block" }}>
      {label}
      <select className="f" value={v} onChange={(e) => on(e.target.value)} style={{ marginTop: 4, width: "100%" }}>
        {opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
      </select>
    </label>
  );
}
function ListEditor({ label, items, on, placeholder }: { label: string; items: string[]; on: (v: string[]) => void; placeholder?: string }) {
  return (
    <label style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600, display: "block", marginTop: 12 }}>
      {label}
      <textarea className="f" value={items.join("\n")} onChange={(e) => on(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
        rows={4} placeholder={placeholder} style={{ marginTop: 4, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
    </label>
  );
}
