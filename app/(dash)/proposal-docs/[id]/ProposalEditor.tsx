"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProposalDocAction, deleteProposalDocAction, generateProposalContentAction, generateProductUspAction, fillReferencesByCategoryAction, pinProposalImagesAction, listBrandOpsQuotesAction, type OpsQuoteForDoc } from "../actions";
import type { ProposalDoc, ProposalProduct, ProposalCreator, ProposalFeature, ProposalValueItem, ProposalStep, ProposalImpact, ProposalAddon } from "@/lib/proposal-doc";
import CategoryPicker from "@/components/CategoryPicker";
import GlovekCategorySelect from "@/components/GlovekCategorySelect";

const TRACKS: [string, string][] = [["onboarding", "온보딩"], ["mall", "멀티몰"], ["marketing", "마케팅"]];

// 숫자 파싱 — 빈값이면 null.
const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, "")) || 0);

export default function ProposalEditor({ doc, publicBase }: { doc: ProposalDoc; publicBase: string }) {
  const router = useRouter();
  const [d, setD] = useState<ProposalDoc>(doc);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [uspInfo, setUspInfo] = useState("");   // 핵심 SKU USP 생성용 상품정보
  const [refCat, setRefCat] = useState("");      // 카테고리 레퍼런스용
  const [quotes, setQuotes] = useState<OpsQuoteForDoc[] | null>(null);  // 불러온 운영 견적 목록
  const [showQuotes, setShowQuotes] = useState(false);
  const set = <K extends keyof ProposalDoc>(k: K, v: ProposalDoc[K]) => setD((p) => ({ ...p, [k]: v }));
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const publicUrl = `${publicBase}/proposal/${d.token}`;

  async function save(publish?: boolean) {
    setBusy(true);
    try {
      const r = await saveProposalDocAction({
        id: d.id, title: d.title, subtitle: d.subtitle, brand_name: d.brand_name, brand_logo_url: d.brand_logo_url,
        track: d.track, list_amount: d.list_amount, monthly_amount: d.monthly_amount, fee_pct: d.fee_pct,
        term_months: d.term_months, term_discount_pct: d.track === "onboarding" ? null : d.term_discount_pct, features: d.features,
        seeding_qty: d.seeding_qty, live_qty: d.live_qty, op_tags: d.op_tags,
        kpi_tier: d.kpi_tier, kpi_stage: d.kpi_stage, kpi_creator_content: d.kpi_creator_content, kpi_ad_spend: d.kpi_ad_spend,
        products: d.products, creators: d.creators, accent: d.accent, accent2: d.accent2 ?? null, start_ym: d.start_ym ?? null,
        product_en: d.product_en, product_volume: d.product_volume, product_features: d.product_features, product_tags: d.product_tags,
        value_items: d.value_items, value_total: d.value_total,
        roadmap_steps: d.roadmap_steps, impacts: d.impacts, impact_banner: d.impact_banner,
        kpi_year_tier: d.kpi_year_tier, kpi_year_stage: d.kpi_year_stage, kpi_year_creator_content: d.kpi_year_creator_content, kpi_year_ad_spend: d.kpi_year_ad_spend,
        addons: d.addons,
        status: publish === undefined ? d.status : publish ? "published" : "draft",
      });
      if (r.ok) {
        if (publish !== undefined) set("status", publish ? "published" : "draft");
        flash((publish ? "발행되었습니다." : "저장되었습니다.") + (r.routineAdded ? " · 마케팅 루틴 운영대행(시딩·라이브)에 카드가 추가되었습니다." : ""));
        router.refresh();
      }
      else flash(r.error ?? "저장 실패");
    } catch (e) { flash((e as Error).message || "저장 실패"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm("이 제안서를 삭제할까요?")) return;
    await deleteProposalDocAction(d.id); router.push("/proposal-docs");
  }
  // 미리보기 — 현재 편집중 값을 먼저 저장한 뒤 새 탭으로 연다(저장 안 하면 미리보기가 이전 값으로 보이는 문제 방지).
  //  팝업차단 회피: 사용자 클릭 시점에 탭을 먼저 열고, 저장 후 이동.
  async function openPreview() {
    const w = window.open("", "_blank");
    await save();
    const url = `${publicUrl}?preview=1`;
    if (w) w.location.href = url; else window.open(url, "_blank");
  }
  // AI 기본내용 생성 — 브랜드 URL 크롤 + glovek 유사 콘텐츠로 초안 채움(저장은 별도).
  async function genAI() {
    if (!confirm("브랜드 제출 URL을 참고해 핵심 SKU 소개·부제·콘텐츠 레퍼런스를 AI로 생성합니다.\n(기존 특징/태그는 대체되고, 콘텐츠 레퍼런스는 추가됩니다. 저장 전까지 되돌릴 수 있어요.)")) return;
    setBusy(true);
    let r;
    try { r = await generateProposalContentAction(d.id); }
    catch (e) { flash((e as Error).message || "AI 생성 실패"); setBusy(false); return; }
    setBusy(false);
    if (!r.ok) { flash(r.error ?? "AI 생성 실패"); return; }
    setD((p) => {
      const next = { ...p };
      if (r.subtitle) next.subtitle = r.subtitle;
      if (r.product_en) next.product_en = r.product_en;
      if (r.product_volume) next.product_volume = r.product_volume;
      if (r.product_features?.length) next.product_features = r.product_features;
      if (r.product_tags?.length) next.product_tags = r.product_tags;
      if (r.featured?.name && p.products.length === 0) next.products = [{ name: r.featured.name, image_url: r.featured.image_url }];
      else if (r.featured?.image_url && p.products.length > 0 && !p.products[0].image_url) next.products = p.products.map((x, i) => (i === 0 ? { ...x, image_url: r.featured!.image_url } : x));
      if (r.creators?.length) next.creators = [...p.creators, ...r.creators];
      return next;
    });
    flash(`AI 초안 반영됨 — ${r.note ?? ""} · 확인 후 저장하세요.`);
  }
  // 상품정보 → USP(특징 카드)·태그·영문명·용량 생성.
  async function genUsp() {
    setBusy(true);
    let r; try { r = await generateProductUspAction(d.id, uspInfo || undefined); }
    catch (e) { flash((e as Error).message || "USP 생성 실패"); setBusy(false); return; }
    setBusy(false);
    if (!r.ok) { flash(r.error ?? "USP 생성 실패"); return; }
    setD((p) => ({
      ...p,
      product_en: r.product_en ?? p.product_en,
      product_volume: r.product_volume ?? p.product_volume,
      product_features: r.product_features?.length ? r.product_features : p.product_features,
      product_tags: r.product_tags?.length ? r.product_tags : p.product_tags,
    }));
    flash("USP 특징 카드가 생성됐습니다 — 확인 후 저장하세요.");
  }
  // 카테고리 → glovek 유사 콘텐츠(썸네일)로 콘텐츠 레퍼런스 추가.
  async function fillRefs() {
    setBusy(true);
    let r; try { r = await fillReferencesByCategoryAction(d.id, refCat || undefined); }
    catch (e) { flash((e as Error).message || "불러오기 실패"); setBusy(false); return; }
    setBusy(false);
    if (!r.ok) { flash(r.error ?? "불러오기 실패"); return; }
    if (r.creators?.length) setD((p) => ({ ...p, creators: [...p.creators, ...r.creators!] }));
    flash(r.note ?? "완료");
  }
  // 이미지 영구저장(복구) — 저장된 외부 이미지(로고·제품·레퍼런스)를 서버 DB 로 옮겨 항상 뜨게.
  async function pinImages() {
    setBusy(true);
    let r; try { r = await pinProposalImagesAction(d.id); }
    catch (e) { flash((e as Error).message || "영구저장 실패"); setBusy(false); return; }
    setBusy(false);
    if (!r.ok) { flash(r.error ?? "영구저장 실패"); return; }
    setD((p) => ({ ...p, brand_logo_url: r.brand_logo_url ?? p.brand_logo_url, products: r.products ?? p.products, creators: r.creators ?? p.creators }));
    flash(`이미지 영구저장 완료 — 외부 저장 ${r.fixed ?? 0}건 · 내부 정상 ${r.ok_count ?? 0}건 · 복구 ${r.healed ?? 0}건${r.dead?.length ? ` · 실패 ${r.dead.length}건(${r.dead.slice(0, 3).join(", ")}${r.dead.length > 3 ? " 외" : ""})` : ""}`);
    router.refresh();
  }
  // 운영 견적 불러오기 — 이 브랜드의 #2 견적 목록을 열어 선택 → 가격조건에 채운다(저장은 별도, 수기 수정 가능).
  async function loadQuotes() {
    setBusy(true);
    let r; try { r = await listBrandOpsQuotesAction(d.id); }
    catch (e) { flash((e as Error).message || "견적 불러오기 실패"); setBusy(false); return; }
    setBusy(false);
    if (!r.ok) { flash(r.error ?? "견적 불러오기 실패"); return; }
    setQuotes(r.quotes ?? []);
    setShowQuotes(true);
    if ((r.quotes ?? []).length === 0) flash("이 브랜드로 생성된 운영 견적이 없습니다 — 제안서(견적) 화면에서 먼저 생성하세요.");
  }
  // 선택한 견적을 가격조건 필드에 반영(수기 수정 가능). 기능 체크리스트에는 제안견적 항목을 추가한다.
  function applyQuote(qz: OpsQuoteForDoc) {
    setD((p) => {
      const merged = [...p.features];
      for (const line of qz.featureLines) if (!merged.includes(line)) merged.push(line);
      return {
        ...p,
        monthly_amount: qz.monthly || p.monthly_amount,
        term_months: qz.months || p.term_months,
        list_amount: qz.total || p.list_amount,
        features: merged,
      };
    });
    setShowQuotes(false);
    flash("견적을 가격조건에 반영했습니다 — 확인 후 저장하세요.");
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 상단 액션 */}
      <div className="card" style={{ padding: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: d.status === "published" ? "#12b886" : "#f0a02c", fontWeight: 700 }}>
          {d.status === "published" ? "● 발행됨" : "○ 초안"}
        </span>
        <button className="btn sm" disabled={busy} onClick={openPreview} title="현재 편집 내용을 저장하고 미리보기를 엽니다">미리보기 ↗</button>
        <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(publicUrl); flash("공개 링크 복사됨"); }}>공개링크 복사</button>
        <button className="btn sm" disabled={busy} onClick={genAI} title="브랜드 URL 크롤 + glovek 유사 콘텐츠로 기본내용 생성">🤖 AI 기본내용 생성</button>
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
          {/* 운영 시작 시점 — 제안서에 "언제부터"를 명시(로드맵 기준월). */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>운영 시작 (연월)</div>
            <input className="f" type="month" value={d.start_ym ?? ""}
              onChange={(e) => set("start_ym", e.target.value || null)} style={{ width: 180 }} />
            <div style={{ fontSize: 10.5, color: "var(--ink3)", marginTop: 3 }}>
              비우면 제안서에 표시하지 않습니다 — 지정하면 표지·실행 로드맵에 시작 시점이 노출됩니다.
            </div>
          </div>
          <F label="배경색(표지·페이지 톤, 예: #1d4ed8)" v={d.accent2 ?? ""} on={(v) => set("accent2", v || null)} placeholder="비우면 기본(핑크·보라 계열)" />
        </Grid>
      </Card>

      {/* 가격 조건 */}
      <Card title="가격 조건">
        {/* 운영 견적(#2) 불러오기 — 없으면 수기 입력 그대로. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: 10, border: "1px dashed var(--line)", borderRadius: 8, background: "var(--bg)" }}>
          <span style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>📄 운영 견적 불러오기</span>
          <button className="btn sm" disabled={busy} onClick={loadQuotes}>이 브랜드 견적 불러오기</button>
          <span style={{ fontSize: 11, color: "var(--ink3)" }}>선택 시 월 금액·약정 개월·계약총액이 채워지고, 견적 항목이 기능 체크리스트에 추가됩니다(수기 수정 가능).</span>
        </div>
        {showQuotes && quotes && quotes.length > 0 && (
          <div style={{ marginBottom: 10, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            {quotes.map((qz) => (
              <div key={qz.id} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12 }}>
                  <b>{qz.trackLabel}</b>
                  {qz.countries.length ? <span style={{ color: "var(--ink3)" }}> · {qz.countries.join("·")}</span> : null}
                  <span style={{ color: "var(--ink3)" }}> · {qz.mode === "commitment" ? `약정 ${qz.months}개월` : "월 정기결제"}</span>
                  <span> · 월 {qz.monthly.toLocaleString("ko-KR")}원</span>
                  <span style={{ color: "var(--ink3)" }}> · {new Date(qz.created_at).toLocaleDateString("ko-KR")} · {qz.status}</span>
                </div>
                <button className="btn sm primary" onClick={() => applyQuote(qz)}>반영</button>
              </div>
            ))}
            <div style={{ padding: "6px 10px", textAlign: "right" }}>
              <button className="btn sm" onClick={() => setShowQuotes(false)}>닫기</button>
            </div>
          </div>
        )}
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
        <div style={{ marginTop: 12, padding: 10, border: "1px dashed var(--line)", borderRadius: 8, background: "var(--bg)" }}>
          <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600, marginBottom: 6 }}>🤖 상품정보 → USP 자동 생성</div>
          <textarea value={uspInfo} onChange={(e) => setUspInfo(e.target.value)} rows={2}
            placeholder="상품 정보를 붙여넣으면 USP(특징 카드)·태그를 뽑아줍니다. (제품명·설명만 있어도 동작)"
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
          <button className="btn sm primary" disabled={busy} onClick={genUsp} style={{ marginTop: 6 }}>USP 생성 → 특징 카드 채우기</button>
        </div>
        <TitleDescEditor label="특징 카드 (USP · 제목 + 설명)" items={d.product_features} on={(v) => set("product_features", v)} ph="제목(예: 밤 사이 유효성분 잠금)" ph2="설명" />
        <ListEditor label="해시태그 (한 줄에 하나, # 제외)" items={d.product_tags} on={(v) => set("product_tags", v)} placeholder="예: 나이트랩핑" />
      </Card>

      {/* 제품 레퍼런스 */}
      <Card title={`제품 레퍼런스 (${d.products.length})`}>
        <ProductsEditor items={d.products} on={(v) => set("products", v)} />
      </Card>

      {/* 상당 구성 가치 */}
      <Card title={`상당 구성 가치 명세 (${d.value_items.length})`}>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 8 }}>공개 제안서에는 <b>합계(상당)</b>만 표시되고 항목별 개별 단가는 표기되지 않습니다.</div>
        <ValueItemsEditor items={d.value_items} on={(v) => set("value_items", v)} />
        <div style={{ marginTop: 10, maxWidth: 260 }}>
          <F label="합계(상당, 원 · 공개 표시)" v={d.value_total?.toString() ?? ""} on={(v) => set("value_total", numOrNull(v))} />
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
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: 10, border: "1px dashed var(--line)", borderRadius: 8, background: "var(--bg)" }}>
          <span style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>🖼️ 카테고리 → glovek 레퍼런스</span>
          <CategoryPicker value={refCat} onChange={setRefCat} compact />
          <GlovekCategorySelect onPick={setRefCat} />
          <button className="btn sm primary" disabled={busy} onClick={fillRefs}>썸네일 레퍼런스 불러오기</button>
          <button className="btn sm" disabled={busy} onClick={pinImages} title="저장된 외부 이미지(로고·제품·레퍼런스)를 서버에 영구 저장해 만료·차단과 무관하게 항상 표시">🖼 이미지 영구저장(복구)</button>
          <span style={{ fontSize: 11, color: "var(--ink3)" }}>소분류(세부)까지 선택 권장 — 소분류 우선, 없으면 대분류로 검색(매출·ROAS는 수동)</span>
        </div>
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
            <input className="f" value={c.link ?? ""} onChange={(e) => upd(i, { link: e.target.value })} placeholder="콘텐츠 링크(틱톡 URL)" style={{ gridColumn: "span 2" }} />
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

// ── 상당 구성 가치(라벨 · 수량) — 개별 단가는 공개 제안서에 표기하지 않음(합계 상당만 노출) ──
function ValueItemsEditor({ items, on }: { items: ProposalValueItem[]; on: (v: ProposalValueItem[]) => void }) {
  const upd = (i: number, patch: Partial<ProposalValueItem>) => on(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr auto", gap: 6, fontSize: 11, color: "var(--ink3)" }}>
        <span>항목</span><span>수량(선택)</span><span />
      </div>
      {items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr auto", gap: 6, alignItems: "center" }}>
          <input className="f" value={it.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="예: 시딩" />
          <input className="f" value={it.qty ?? ""} onChange={(e) => upd(i, { qty: e.target.value })} placeholder="예: 20건" />
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
