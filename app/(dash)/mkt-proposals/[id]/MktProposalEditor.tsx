"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MktProposalView from "@/components/MktProposalView";
import ContentBriefRef from "@/components/ContentBriefRef";
import CategoryPicker from "@/components/CategoryPicker";
import GlovekCategorySelect from "@/components/GlovekCategorySelect";
import { COUNTRY_LABEL, computeBudgetPlan, PHASE_RATIO, normalizeOverrides, type MktCountry, type Phase, type PhaseRatios, type MonthOverride, type MonthOverrideMap } from "@/lib/mkt-proposal-engine";
import type { MktProposalDocRow, MktProductItem, MktReferenceItem, MktTemplateConfig } from "@/lib/mkt-proposal-doc";
import { saveMktProposalDocAction, deleteMktProposalDocAction, linkMktProposalToPipelineAction, saveMktTemplateAction, loadMktTemplateAction, deleteMktTemplateAction, fillGlovekMktRefsAction, pinMktProposalImagesAction, importOpsRefsAction, fillProductUspFromSurveyAction, fillProductFromLinkAction, importRefsByProductTypeAction } from "../actions";
import { addMonths, currentYM, monthWindow, rangeFromSelection, inRange, ymKey, type YM } from "@/lib/month-window";

const MAN = 10000;
const toMan = (won: number) => Math.round((won || 0) / MAN);
const COUNTRIES: MktCountry[] = ["US", "VN", "TH", "PH", "MY", "SG"];
const PHASES: Phase[] = ["BUILD", "GROWTH", "PEAK", "MEGA"];

type TplItem = { id: string; name: string };

export default function MktProposalEditor({ doc, brands, templates = [] }: { doc: MktProposalDocRow; brands: { id: string; brand_name: string }[]; templates?: TplItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const [brandId, setBrandId] = useState(doc.brand_id ?? "");
  const [title, setTitle] = useState(doc.title);
  const [subtitle, setSubtitle] = useState(doc.subtitle);
  const [status, setStatus] = useState(doc.status);
  const [accent, setAccent] = useState(doc.accent || "#111111");
  const [accent2, setAccent2] = useState(doc.accent2 || "#0b1220");
  const [showBundle, setShowBundle] = useState(doc.show_bundle_slide ?? true);
  const [countries, setCountries] = useState<string[]>(doc.countries?.length ? doc.countries : ["US"]);
  const [startMonth, setStartMonth] = useState(doc.start_month);
  const [startYear, setStartYear] = useState<number>(doc.start_year ?? new Date().getFullYear());
  const [months, setMonths] = useState(doc.months);
  // 기간 선택용 12개월 창 — 이번 달부터(지난 달로 시작할 일은 없다). 저장된 시작월이
  //   창보다 앞서면 그 달부터 펼쳐 기존 제안서도 그대로 보이게 한다.
  const winStart: YM = (() => {
    const now = currentYM();
    const saved: YM = { year: startYear, month: startMonth };
    return saved.year * 12 + saved.month < now.year * 12 + now.month ? saved : now;
  })();
  const window12 = monthWindow(winStart, 12);
  const pickRange = (s2: YM, n: number) => { setStartYear(s2.year); setStartMonth(s2.month); setMonths(n); };
  function toggleMonth(v: YM) {
    const cur = window12.filter((w) => inRange(w, { year: startYear, month: startMonth }, months));
    const has = cur.some((c) => ymKey(c) === ymKey(v));
    const next = has ? cur.filter((c) => ymKey(c) !== ymKey(v)) : [...cur, v];
    const r = rangeFromSelection(next);
    if (!r) return; // 전부 해제는 무시(최소 1개월)
    pickRange(r.start, r.months);
  }
  const [monthlyMan, setMonthlyMan] = useState(toMan(doc.monthly_budget));
  const [opFeeMan, setOpFeeMan] = useState(toMan(doc.operation_fee));
  const [gmvMinMan, setGmvMinMan] = useState(toMan(doc.gmv_reserve_min));
  const [gmvMaxMan, setGmvMaxMan] = useState(toMan(doc.gmv_reserve_max));
  const [firstSeed, setFirstSeed] = useState(doc.first_month_seeding);
  const [commission, setCommission] = useState(doc.commission_pct);
  const [goalFirst, setGoalFirst] = useState(doc.goal_first);
  const [goalFinal, setGoalFinal] = useState(doc.goal_final);
  const [intro, setIntro] = useState(doc.intro_note);
  const [products, setProducts] = useState<MktProductItem[]>(doc.products_json ?? []);
  const [refs, setRefs] = useState<MktReferenceItem[]>(doc.references_json ?? []);
  // 페이즈 비율 오버라이드(기본값 위 병합) + 월별 수동 오버라이드.
  const [ratios, setRatios] = useState<PhaseRatios>(() => {
    const r = { ...PHASE_RATIO } as PhaseRatios;
    for (const p of PHASES) { const o = doc.phase_ratios_json?.[p]; if (o) r[p] = { organic: o.organic, paid: o.paid }; }
    return r;
  });
  // 월별 오버라이드는 국가별로 따로 — 국가마다 시즌(11.11 · Songkran · Tết)이 달라 한 국가의 조정을
  //   다른 국가에 그대로 씌우면 전 국가가 같은 값이 된다. 레거시(배열)는 기준 국가 것으로 읽는다.
  const [ovMap, setOvMap] = useState<MonthOverrideMap>(
    () => normalizeOverrides(doc.month_overrides_json, (doc.countries?.[0] ?? "US")),
  );
  const [ovCountry, setOvCountry] = useState<MktCountry>((doc.countries?.[0] ?? "US") as MktCountry);
  const overrides = ovMap[ovCountry] ?? [];
  const [tpls, setTpls] = useState<TplItem[]>(templates);
  const [tplSel, setTplSel] = useState("");
  // 생성방식(0087)에 따라 목록 복귀 경로 분기 — 설문 자동생성(방식2)은 /mkt-proposals2 로.
  const listHref = doc.gen_source === "survey_auto" ? "/mkt-proposals2" : "/mkt-proposals";
  // 틱톡 레퍼런스 자동조회(Apify) — DB에 저장된 제품 기준으로 실행되므로 제품 수정 후엔 먼저 저장.
  const [ttBusy, setTtBusy] = useState(false);
  const [ttMsg, setTtMsg] = useState("");
  async function fetchTikTokRefs() {
    if (ttBusy) return;
    setTtBusy(true); setTtMsg("");
    try {
      const res = await fetch("/api/tiktok-refs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: doc.id }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: "응답 해석 실패" }));
      if (!j.ok || !Array.isArray(j.refs)) { setTtMsg(j.error ?? "조회 실패"); return; }
      setRefs((prev) => [...j.refs, ...prev]);
      const warn = (j.warnings ?? []).length ? ` · 참고: ${j.warnings.join(" / ")}` : "";
      setTtMsg(`✅ ${j.refs.length}건 수집됨 — 확인 후 [저장]을 눌러 반영하세요.${warn}`);
    } catch {
      setTtMsg("네트워크 오류 또는 시간 초과 — 다시 시도해주세요.");
    } finally {
      setTtBusy(false);
    }
  }

  // 이미지 영구저장(복구) — 저장된 외부 이미지(제품·레퍼런스)를 서버 DB 로 옮겨 항상 뜨게.
  async function pinImages() {
    if (gvBusy) return;
    setGvBusy(true); setTtMsg("");
    try {
      const r = await pinMktProposalImagesAction(doc.id);
      if (!r.ok) { setTtMsg(r.error ?? "영구저장 실패"); return; }
      if (r.references_json) setRefs(r.references_json);
      if (r.products_json) setProducts(r.products_json);
      setTtMsg(`🖼 이미지 영구저장 완료 — 외부 저장 ${r.fixed ?? 0}건 · 내부 정상 ${r.ok_count ?? 0}건 · 복구 ${r.healed ?? 0}건${r.dead?.length ? ` · 실패 ${r.dead.length}건(${r.dead.slice(0, 3).join(", ")}${r.dead.length > 3 ? " 외" : ""})` : ""}`);
    } catch {
      setTtMsg("영구저장 중 오류 — 다시 시도해주세요.");
    } finally {
      setGvBusy(false);
    }
  }
  // glovek 유사 콘텐츠 레퍼런스 — 담당자가 직접 고른 카테고리(대분류>소분류) 기준으로 조회.
  const [category, setCategory] = useState(doc.category ?? "");
  const [gvBusy, setGvBusy] = useState(false);
  async function fetchGlovekRefs() {
    if (gvBusy) return;
    setGvBusy(true); setTtMsg("");
    try {
      // 설문·상품링크 유래 제품명(미저장분 포함)도 함께 전달 — 카테고리 매칭 실패 시 자동 폴백 검색.
      const names = products.flatMap((p) => [p.name_en, p.name]).filter((v): v is string => Boolean(v?.trim()));
      const r = await fillGlovekMktRefsAction(doc.id, category, names);
      if (!r.ok) { setTtMsg(r.error ?? "조회 실패"); return; }
      if (r.refs?.length) setRefs((prev) => [...r.refs!, ...prev]);
      setTtMsg(`${r.refs?.length ? "✅ " : ""}${r.note ?? ""}${r.refs?.length ? " — 확인 후 [저장]을 눌러 반영하세요." : ""}`);
    } catch {
      setTtMsg("glovek 조회 중 오류 — 다시 시도해주세요.");
    } finally {
      setGvBusy(false);
    }
  }

  // 운영 제안서 레퍼런스 가져오기 — 마케팅 제안은 보통 운영대행 제안 다음이라,
  //   그때 나갔던 레퍼런스를 출발점으로 삼고 여기에 추가하는 흐름이 자연스럽다(중복은 자동 제외).
  async function importOpsRefs() {
    if (gvBusy) return;
    setGvBusy(true); setTtMsg("");
    try {
      const r = await importOpsRefsAction(doc.id);
      if (!r.ok) { setTtMsg(r.error ?? "가져오기 실패"); return; }
      if (r.refs?.length) setRefs((prev) => [...r.refs!, ...prev]);
      setTtMsg(`✅ ${r.note ?? "가져왔습니다."}`);
    } catch {
      setTtMsg("운영 제안서 레퍼런스 가져오기 중 오류 — 다시 시도해주세요.");
    } finally {
      setGvBusy(false);
    }
  }

  // 사전 설문 → 핵심 SKU USP — 마케팅 제안서는 운영대행 계약 전에 나가는 경우가 많아
  //   (계약 후 작성되는) 콘텐츠 브리프 대신 문의 단계 사전 설문을 기준으로 삼는다.
  async function fillUspFromSurvey() {
    if (gvBusy) return;
    setGvBusy(true); setTtMsg("");
    try {
      const r = await fillProductUspFromSurveyAction(doc.id);
      if (!r.ok) { setTtMsg(r.error ?? "불러오기 실패"); return; }
      if (r.products) setProducts(r.products);
      setTtMsg(`✅ ${r.note ?? "반영됨"}`);
    } catch { setTtMsg("사전 설문 조회 중 오류 — 다시 시도해주세요."); }
    finally { setGvBusy(false); }
  }

  // 상품 링크 → 제품명·영문명·용량·특징 자동 채움(설문이 없거나 부실할 때의 보완 경로).
  const [linkBusy, setLinkBusy] = useState<number | null>(null);
  async function fillFromLink(i: number) {
    const url = window.prompt("상품 링크를 입력하세요 (제품명·영문명·용량·특징을 자동으로 불러옵니다)", "");
    if (!url?.trim()) return;
    setLinkBusy(i); setTtMsg("");
    try {
      const r = await fillProductFromLinkAction(doc.id, i, url.trim());
      if (!r.ok) { setTtMsg(r.error ?? "불러오기 실패"); return; }
      if (r.product) setProducts((prev) => prev.map((p, idx) => (idx === i ? r.product! : p)));
      setTtMsg(`✅ ${r.note ?? "반영됨"} — 확인 후 [저장]을 눌러 반영하세요.`);
    } catch { setTtMsg("상품 링크 조회 중 오류 — 다시 시도해주세요."); }
    finally { setLinkBusy(null); }
  }

  // 제품 유형(샴푸 등)으로 기존 제안서에서 직접 넣었던 레퍼런스를 다시 꺼내 쓴다.
  async function importRefsByType() {
    if (gvBusy) return;
    const kw = window.prompt(
      "제품 유형을 입력하세요 — 기존 제안서(마케팅·운영)에서 그 유형으로 넣었던 레퍼런스를 가져옵니다.\n예: 샴푸 / 앰플 / 선크림",
      category.split(">").pop()?.trim() || "",
    );
    if (!kw?.trim()) return;
    setGvBusy(true); setTtMsg("");
    try {
      const r = await importRefsByProductTypeAction(doc.id, kw.trim());
      if (!r.ok) { setTtMsg(r.error ?? "가져오기 실패"); return; }
      if (r.refs?.length) setRefs((prev) => [...r.refs!, ...prev]);
      setTtMsg(`✅ ${r.note ?? "가져왔습니다."}`);
    } catch { setTtMsg("유형별 레퍼런스 조회 중 오류 — 다시 시도해주세요."); }
    finally { setGvBusy(false); }
  }

  function toggleCountry(c: string) {
    setCountries((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }
  function setRatio(p: Phase, organic: number) {
    const org = Math.max(0, Math.min(10, organic));
    setRatios((r) => ({ ...r, [p]: { organic: org, paid: 10 - org } }));
  }
  function setOv(i: number, patch: Partial<MonthOverride>) {
    setOvMap((prev) => {
      const arr = (prev[ovCountry] ?? []).slice();
      while (arr.length <= i) arr.push(null);
      const merged = { ...(arr[i] ?? {}), ...patch };
      // 모든 필드가 비면 null 로(자동 복귀).
      const empty = merged.organic == null && merged.paid == null && !merged.event && !merged.note && !merged.phase;
      arr[i] = empty ? null : merged;
      const next = { ...prev, [ovCountry]: arr };
      // 전부 비었으면 그 국가 키 자체를 제거(저장값을 깔끔하게 유지).
      if (arr.every((x) => x == null)) delete next[ovCountry];
      return next;
    });
  }

  // ── 템플릿: 현재 설정 저장 / 불러오기 / 삭제 ──
  function currentConfig(): MktTemplateConfig {
    return {
      subtitle, accent, accent2, show_bundle_slide: showBundle,
      countries, start_month: startMonth, months,
      monthly_budget: monthlyMan * MAN, operation_fee: opFeeMan * MAN,
      gmv_reserve_min: gmvMinMan * MAN, gmv_reserve_max: gmvMaxMan * MAN,
      first_month_seeding: firstSeed, commission_pct: commission,
      goal_first: goalFirst, goal_final: goalFinal, phase_ratios_json: ratios, intro_note: intro,
    };
  }
  function applyConfig(c: MktTemplateConfig) {
    if (c.subtitle != null) setSubtitle(c.subtitle);
    if (c.accent) setAccent(c.accent);
    if (c.accent2) setAccent2(c.accent2);
    if (c.show_bundle_slide != null) setShowBundle(c.show_bundle_slide);
    if (c.countries?.length) setCountries(c.countries);
    if (c.start_month) setStartMonth(c.start_month);
    if (c.months) setMonths(c.months);
    if (c.monthly_budget != null) setMonthlyMan(toMan(c.monthly_budget));
    if (c.operation_fee != null) setOpFeeMan(toMan(c.operation_fee));
    if (c.gmv_reserve_min != null) setGmvMinMan(toMan(c.gmv_reserve_min));
    if (c.gmv_reserve_max != null) setGmvMaxMan(toMan(c.gmv_reserve_max));
    if (c.first_month_seeding != null) setFirstSeed(c.first_month_seeding);
    if (c.commission_pct != null) setCommission(c.commission_pct);
    if (c.goal_first != null) setGoalFirst(c.goal_first);
    if (c.goal_final != null) setGoalFinal(c.goal_final);
    if (c.intro_note != null) setIntro(c.intro_note);
    if (c.phase_ratios_json) {
      const r = { ...PHASE_RATIO } as PhaseRatios;
      for (const p of PHASES) { const o = c.phase_ratios_json[p]; if (o) r[p] = { organic: o.organic, paid: o.paid }; }
      setRatios(r);
    }
  }
  function saveTpl() {
    const name = prompt("템플릿 이름을 입력하세요.", subtitle || "제안서 템플릿");
    if (!name) return;
    setMsg("");
    start(async () => {
      const r = await saveMktTemplateAction(name, currentConfig());
      if (!r.ok) { setMsg(r.error ?? "템플릿 저장 실패"); return; }
      setTpls((t) => [{ id: r.id!, name }, ...t]);
      setMsg(`템플릿 "${name}" 저장됨.`);
    });
  }
  function loadTpl() {
    if (!tplSel) { setMsg("불러올 템플릿을 선택하세요."); return; }
    setMsg("");
    start(async () => {
      const r = await loadMktTemplateAction(tplSel);
      if (!r.ok || !r.config) { setMsg(r.error ?? "불러오기 실패"); return; }
      applyConfig(r.config);
      setMsg(`템플릿 "${r.name}" 을(를) 적용했습니다. (저장 눌러 반영)`);
    });
  }
  function delTpl() {
    if (!tplSel || !confirm("이 템플릿을 삭제할까요?")) return;
    start(async () => {
      const r = await deleteMktTemplateAction(tplSel);
      if (r.ok) { setTpls((t) => t.filter((x) => x.id !== tplSel)); setTplSel(""); setMsg("템플릿 삭제됨."); }
      else setMsg(r.error ?? "삭제 실패");
    });
  }

  // 오버라이드 표용 자동 베이스라인(오버라이드 제외, 첫 국가 기준).
  const baseCountry = (countries[0] ?? "US") as MktCountry;
  // 월별 배분표의 자동값은 "지금 편집 중인 국가" 캘린더 기준으로 보여야 한다.
  const basePlan = computeBudgetPlan({
    monthlyBudget: monthlyMan * MAN, country: ovCountry, startMonth, months,
    firstMonthSeedingOnly: firstSeed, phaseRatios: ratios,
  });

  // 미리보기용 doc 재조립(만원 → 원).
  const preview: MktProposalDocRow = {
    ...doc, brand_id: brandId || null, title, subtitle, status, accent, accent2, show_bundle_slide: showBundle,
    countries: countries.length ? countries : ["US"], start_month: startMonth, start_year: startYear, months,
    monthly_budget: monthlyMan * MAN, operation_fee: opFeeMan * MAN,
    gmv_reserve_min: gmvMinMan * MAN, gmv_reserve_max: gmvMaxMan * MAN,
    first_month_seeding: firstSeed, commission_pct: commission,
    goal_first: goalFirst, goal_final: goalFinal, intro_note: intro,
    products_json: products, references_json: refs,
    phase_ratios_json: ratios, month_overrides_json: ovMap,
    brand_name: brands.find((b) => b.id === brandId)?.brand_name ?? doc.brand_name,
  };

  async function doSave(): Promise<boolean> {
    const r = await saveMktProposalDocAction({
      id: doc.id, brand_id: brandId || null, title, subtitle, status, accent, accent2, show_bundle_slide: showBundle,
      countries, start_month: startMonth, months,
      monthly_budget: monthlyMan * MAN, operation_fee: opFeeMan * MAN,
      gmv_reserve_min: gmvMinMan * MAN, gmv_reserve_max: gmvMaxMan * MAN,
      first_month_seeding: firstSeed, commission_pct: commission,
      goal_first: goalFirst, goal_final: goalFinal, intro_note: intro,
      products_json: products, references_json: refs,
      phase_ratios_json: ratios, month_overrides_json: ovMap,
      category,
    });
    if (!r.ok) { setMsg(r.error ?? "저장 실패"); return false; }
    return true;
  }
  function save(after?: "pipeline") {
    setMsg("");
    start(async () => {
      if (!(await doSave())) return;
      if (after === "pipeline") {
        const lr = await linkMktProposalToPipelineAction(doc.id);
        setMsg(lr.ok ? "저장 + 파이프라인 연동 완료 — /mkt 에서 카드로 표시됩니다." : lr.error ?? "연동 실패");
      } else setMsg("저장되었습니다.");
      router.refresh();
    });
  }
  // 미리보기 — 현재 편집중 값을 먼저 저장한 뒤 공개 페이지를 연다(저장 안 하면 옛 버전이 보이는 문제 방지).
  //   팝업차단 회피: 클릭 시점에 빈 탭을 먼저 열고, 저장 후 이동.
  function openPreview() {
    const w = window.open("", "_blank");
    setMsg("");
    start(async () => {
      const ok = await doSave();
      const url = `/mkt-proposal/${doc.token}`;
      if (ok) setMsg("저장 후 미리보기를 열었습니다.");
      if (w) w.location.href = url; else window.open(url, "_blank");
      if (ok) router.refresh();
    });
  }
  function del() {
    if (!confirm("이 마케팅 제안서를 삭제할까요?")) return;
    start(async () => {
      const r = await deleteMktProposalDocAction(doc.id);
      if (r.ok) router.push(listHref); else setMsg(r.error ?? "삭제 실패");
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 16, alignItems: "start" }}>
      {/* ── 편집 ── */}
      <div style={{ display: "grid", gap: 12 }}>
        <div className="bar" style={{ margin: 0 }}>
          <Link href={listHref} className="btn sm">← 목록</Link>
          {doc.gen_source === "survey_auto" && <span className="chip" style={{ fontSize: 10.5 }}>🤖 설문 자동생성</span>}
          <button className="btn sm" disabled={pending} onClick={openPreview} title="현재 편집 내용을 저장한 뒤 공개 페이지를 새 탭으로 엽니다">미리보기(저장 후) ↗</button>
          <button className="btn sm pri" disabled={pending} onClick={() => save()}>{pending ? "저장 중…" : "저장"}</button>
          <button className="btn sm" disabled={pending} onClick={() => save("pipeline")} title="브랜드의 마케팅 파이프라인 카드로 등록·연동">파이프라인 연동</button>
          <button className="btn sm" disabled={pending} onClick={del} style={{ color: "#e03131", marginLeft: "auto" }}>삭제</button>
        </div>
        {msg && <div className="note">{msg}</div>}

        <Card title="기본">
          <L>브랜드</L>
          <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">(연결 안 함)</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
          </select>
          <L>제목</L><input className="f" value={title} onChange={(e) => setTitle(e.target.value)} />
          <L>부제</L><input className="f" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><L>상태</L>
              <select className="f" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="draft">작성 중</option><option value="sent">발송</option><option value="accepted">수주</option><option value="rejected">드랍</option>
              </select>
            </div>
            <div><L>강조색</L><input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: 44, height: 34, border: "1px solid var(--line)", borderRadius: 6 }} /></div>
            <div><L>배경색2</L><input type="color" value={accent2} onChange={(e) => setAccent2(e.target.value)} style={{ width: 44, height: 34, border: "1px solid var(--line)", borderRadius: 6 }} /></div>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--ink3)", marginTop: 2 }}>강조색·배경색2 두 가지가 표지·비용·번들 장표의 메인 그라디언트로 사용됩니다.</div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 6 }}>
            <input type="checkbox" checked={showBundle} onChange={(e) => setShowBundle(e.target.checked)} /> 세트·번들 구성 장표 포함
          </label>
        </Card>

        <Card title="템플릿 (디자인·예산·비율 저장/불러오기)">
          <div style={{ fontSize: 11, color: "var(--ink3)" }}>브랜드·제목·제품을 뺀 &lsquo;틀&rsquo;만 저장합니다. 불러온 뒤 저장을 눌러야 반영됩니다.</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select className="f" value={tplSel} onChange={(e) => setTplSel(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
              <option value="">템플릿 선택…</option>
              {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="btn sm" disabled={pending || !tplSel} onClick={loadTpl}>불러오기</button>
            <button className="btn sm" disabled={pending || !tplSel} onClick={delTpl} style={{ color: "#e03131" }}>삭제</button>
          </div>
          <button className="btn sm pri" disabled={pending} onClick={saveTpl} style={{ justifySelf: "start" }}>현재 설정을 새 템플릿으로 저장</button>
        </Card>

        <Card title="예산 (엔진 자동계산)">
          <L>대상 국가 (시즌 캘린더)</L>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {COUNTRIES.map((c) => (
              <label key={c} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={countries.includes(c)} onChange={() => toggleCountry(c)} /> {COUNTRY_LABEL[c]}
              </label>
            ))}
          </div>
          <L>진행 기간 (전체 월에서 선택)</L>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <button type="button" className="btn sm" onClick={() => pickRange(currentYM(new Date(), 1), 6)}>다음 달부터 6개월</button>
            <button type="button" className="btn sm" onClick={() => pickRange(currentYM(new Date(), 2), 4)}>다다음 달부터 4개월</button>
            <button type="button" className="btn sm" onClick={() => pickRange(currentYM(new Date(), 1), 12)}>다음 달부터 12개월</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
            {window12.map((w) => {
              const on = inRange(w, { year: startYear, month: startMonth }, months);
              const isStart = w.year === startYear && w.month === startMonth;
              return (
                <label key={ymKey(w)} title={isStart ? "시작 월" : undefined}
                  style={{
                    display: "flex", gap: 4, alignItems: "center", fontSize: 12, padding: "4px 6px", borderRadius: 6,
                    border: `1px solid ${on ? "var(--acc, #c0326a)" : "var(--line)"}`,
                    background: on ? "var(--tint, #fdeef5)" : "transparent", cursor: "pointer",
                  }}>
                  <input type="checkbox" checked={on} onChange={() => toggleMonth(w)} />
                  <span style={{ fontWeight: isStart ? 800 : 600 }}>
                    {w.month === 1 || isStart ? `${String(w.year).slice(2)}.` : ""}{w.month}월
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--ink3)" }}>
            {startYear}년 {startMonth}월부터 {months}개월 — 월별 페이즈·이벤트는 선택 국가 시즌표 기준.
            중간 월만 빼는 것은 예산 엔진 구조상 불가해, 선택하면 처음~마지막 구간이 채워집니다.
          </div>
          <L>월 캠페인 예산 (RFP · 만원) — 무가+유가</L>
          <input className="f" type="number" value={monthlyMan} onChange={(e) => setMonthlyMan(Number(e.target.value))} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><L>운영대행비 (만원/월)</L><input className="f" type="number" value={opFeeMan} onChange={(e) => setOpFeeMan(Number(e.target.value))} /></div>
            <div style={{ flex: 1 }}><L>수수료 %</L><input className="f" type="number" value={commission} onChange={(e) => setCommission(Number(e.target.value))} /></div>
          </div>
          <L>GMV 광고 예비비 (만원, 최소~최대)</L>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="f" type="number" value={gmvMinMan} onChange={(e) => setGmvMinMan(Number(e.target.value))} />
            <input className="f" type="number" value={gmvMaxMan} onChange={(e) => setGmvMaxMan(Number(e.target.value))} />
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 6 }}>
            <input type="checkbox" checked={firstSeed} onChange={(e) => setFirstSeed(e.target.checked)} /> 첫 달 100% 무가 시딩
          </label>
        </Card>

        <Card title="페이즈 비율 (무가:유가 · 제안서별 조정)">
          <div style={{ fontSize: 11, color: "var(--ink3)" }}>각 시즌 페이즈의 무가:유가 기본 비율. 무가 값만 조정하면 유가는 자동(합 10).</div>
          {PHASES.map((p) => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 66, fontSize: 12, fontWeight: 700 }}>{p}</span>
              <input className="f" type="number" min={0} max={10} step={0.5} value={ratios[p].organic}
                onChange={(e) => setRatio(p, Number(e.target.value))} style={{ width: 70 }} />
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>: {ratios[p].paid} (유가)</span>
            </div>
          ))}
        </Card>

        <Card title="월별 배분 (수동 조정 · 그때그때 다르게)">
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>국가별 배분</span>
            {(countries.length ? countries : ["US"]).map((c) => {
              const on = c === ovCountry;
              const edited = (ovMap[c] ?? []).some((x) => x != null);
              return (
                <button key={c} type="button" className={`btn sm${on ? " pri" : ""}`} onClick={() => setOvCountry(c as MktCountry)}
                  title={`${COUNTRY_LABEL[c as MktCountry]} 월별 배분 편집`}>
                  {COUNTRY_LABEL[c as MktCountry]}{edited ? " •" : ""}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink3)" }}>
            빈칸이면 자동(placeholder=자동값, 만원). 값을 넣으면 그 달만 덮어씁니다 —
            <b> {COUNTRY_LABEL[ovCountry]}에만 적용</b>됩니다(국가마다 시즌·페이즈가 달라 따로 관리).
            표시된 자동값도 {COUNTRY_LABEL[ovCountry]} 캘린더 기준입니다.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ color: "var(--ink3)" }}>
                <th style={{ textAlign: "left", padding: 3 }}>월</th><th style={{ padding: 3 }}>페이즈</th><th style={{ padding: 3 }}>무가</th><th style={{ padding: 3 }}>유가</th><th style={{ padding: 3 }}>이벤트딱지</th>
              </tr></thead>
              <tbody>
                {basePlan.months.map((m) => {
                  const ov = overrides[m.index] ?? null;
                  return (
                    <tr key={m.index}>
                      <td style={{ padding: 3, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {(() => { const ym = addMonths({ year: startYear, month: startMonth }, m.index); 
                          return `${ym.month === 1 || m.index === 0 ? `${String(ym.year).slice(2)}.` : ""}${m.calendarMonth}월`; })()}
                      </td>
                      <td style={{ padding: 3 }}>
                        <select className="f" style={{ width: 92 }}
                          value={ov?.phase ?? ""}
                          onChange={(e) => setOv(m.index, { phase: e.target.value === "" ? undefined : (e.target.value as Phase) })}>
                          <option value="">자동({m.phase})</option>
                          {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 3 }}>
                        <input className="f" type="number" style={{ width: 68 }} placeholder={String(toMan(m.organic))}
                          value={ov?.organic != null ? toMan(ov.organic) : ""}
                          onChange={(e) => setOv(m.index, { organic: e.target.value === "" ? undefined : Number(e.target.value) * MAN })} />
                      </td>
                      <td style={{ padding: 3 }}>
                        <input className="f" type="number" style={{ width: 68 }} placeholder={String(toMan(m.paid))}
                          value={ov?.paid != null ? toMan(ov.paid) : ""}
                          onChange={(e) => setOv(m.index, { paid: e.target.value === "" ? undefined : Number(e.target.value) * MAN })} />
                      </td>
                      <td style={{ padding: 3 }}>
                        <input className="f" style={{ width: 110 }} placeholder={m.event ?? "—"}
                          value={ov?.event ?? ""} onChange={(e) => setOv(m.index, { event: e.target.value || undefined })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn sm" style={{ justifySelf: "start" }}
              onClick={() => setOvMap((prev) => { const n = { ...prev }; delete n[ovCountry]; return n; })}>
              {COUNTRY_LABEL[ovCountry]} 자동으로 초기화
            </button>
            {Object.keys(ovMap).length > 1 && (
              <button className="btn sm" onClick={() => setOvMap({})}>전체 국가 초기화</button>
            )}
          </div>
        </Card>

        <Card title="목표">
          <L>1차 목표</L><input className="f" value={goalFirst} onChange={(e) => setGoalFirst(e.target.value)} placeholder="T1 기준 콘텐츠 204건 달성" />
          <L>최종 목표</L><input className="f" value={goalFinal} onChange={(e) => setGoalFinal(e.target.value)} placeholder="T2 진입·판매 기반 확립" />
          <L>서문(선택)</L><textarea className="f" rows={2} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </Card>

        <Card title={`제품 (${products.length})`}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <button className="btn sm pri" disabled={pending || gvBusy} onClick={fillUspFromSurvey}
              title="문의 단계 '사전 설문' 응답(장점·차별점·핵심 메시지)으로 핵심 SKU 제품명·특징을 채웁니다">
              📋 사전 설문에서 USP 불러오기
            </button>
            <span style={{ fontSize: 10.5, color: "var(--ink3)" }}>
              콘텐츠 브리프는 계약·결제 후 작성되므로, 계약 전 제안서는 사전 설문을 기준으로 채웁니다.
            </span>
          </div>
          {products.map((p, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, marginBottom: 6, display: "grid", gap: 4 }}>
              <input className="f" placeholder="제품명" value={p.name} onChange={(e) => setProducts(upd(products, i, { name: e.target.value }))} />
              <div style={{ display: "flex", gap: 6 }}>
                <input className="f" placeholder="영문명" value={p.name_en ?? ""} onChange={(e) => setProducts(upd(products, i, { name_en: e.target.value }))} />
                <input className="f" placeholder="용량" value={p.volume ?? ""} onChange={(e) => setProducts(upd(products, i, { volume: e.target.value }))} style={{ width: 90 }} />
              </div>
              <input className="f" placeholder="이미지 URL" value={p.image_url ?? ""} onChange={(e) => setProducts(upd(products, i, { image_url: e.target.value }))} />
              <textarea className="f" rows={2} placeholder="특징(줄바꿈으로 구분)" value={(p.features ?? []).join("\n")} onChange={(e) => setProducts(upd(products, i, { features: e.target.value.split("\n") }))} />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn sm" disabled={linkBusy === i} onClick={() => fillFromLink(i)}
                  title="상품 링크에서 제품명·영문명·용량·특징을 자동으로 불러옵니다">
                  {linkBusy === i ? "불러오는 중…" : "🔗 상품 링크에서 불러오기"}
                </button>
                <button className="btn sm" onClick={() => setProducts(products.filter((_, j) => j !== i))} style={{ color: "#e03131" }}>제거</button>
              </div>
            </div>
          ))}
          <button className="btn sm" onClick={() => setProducts([...products, { name: "", features: [] }])}>+ 제품 추가</button>
        </Card>

        {/* 콘텐츠 브리프 참조(선택·보조) — 이미 계약·결제까지 끝난 브랜드에서만 존재한다.
            계약 전 제안서의 기준 자료는 위의 "사전 설문에서 USP 불러오기". */}

        <ContentBriefRef brandId={brandId || null} />

        <Card title={`레퍼런스 (${refs.length})`}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <CategoryPicker value={category} onChange={setCategory} compact />
            <GlovekCategorySelect onPick={setCategory} />
            <button className="btn sm" disabled={pending || ttBusy || gvBusy} onClick={importRefsByType}
              title="기존 제안서(마케팅·운영)에서 같은 제품 유형(샴푸 등)으로 넣었던 레퍼런스를 가져옵니다">
              🔁 제품 유형별 레퍼런스 가져오기
            </button>
            <button className="btn sm" disabled={pending || ttBusy || gvBusy} onClick={importOpsRefs}
              title="같은 브랜드의 최신 운영 제안서에 들어간 크리에이터 레퍼런스를 그대로 가져옵니다(중복 제외)">
              📄 운영 제안서 레퍼런스 가져오기
            </button>
            <button className="btn sm pri" disabled={pending || ttBusy || gvBusy} onClick={fetchGlovekRefs}
              title="선택한 카테고리(소분류 우선, 없으면 대분류)로 glovek.space 유사 제품 콘텐츠(썸네일·크리에이터·GMV) 검색">
              {gvBusy ? "glovek 조회 중…" : "🌏 glovek 유사 콘텐츠 불러오기"}
            </button>
            <button className="btn sm" disabled={pending || ttBusy || gvBusy} onClick={pinImages}
              title="저장된 외부 이미지(제품·레퍼런스)를 서버에 영구 저장해 만료·차단과 무관하게 항상 표시">🖼 이미지 영구저장</button>
            <button className="btn sm" disabled={pending || ttBusy || gvBusy} onClick={fetchTikTokRefs}
              title="제품명으로 유사제품 키워드 생성 → 틱톡 영상(조회수 상위 썸네일·크리에이터) + 틱톡샵 유사 제품 자동 수집">
              {ttBusy ? "틱톡 조회 중… (최대 2~3분)" : "🎯 틱톡 자동조회"}
            </button>
            <span style={{ fontSize: 10.5, color: "var(--ink3)" }}>결과 확인 후 반드시 저장 · 틱톡 조회는 저장된 제품 기준</span>
          </div>
          {ttMsg && <div style={{ fontSize: 11.5, color: ttMsg.startsWith("✅") ? "#0b7a52" : "#b45309" }}>{ttMsg}</div>}
          {refs.map((r, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, marginBottom: 6, display: "grid", gap: 4 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="f" placeholder="크리에이터" value={r.creator ?? ""} onChange={(e) => setRefs(upd(refs, i, { creator: e.target.value }))} />
                <input className="f" placeholder="제품" value={r.product ?? ""} onChange={(e) => setRefs(upd(refs, i, { product: e.target.value }))} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="f" placeholder="GMV" value={r.gmv ?? ""} onChange={(e) => setRefs(upd(refs, i, { gmv: e.target.value }))} />
                <input className="f" placeholder="ROAS" value={r.roas ?? ""} onChange={(e) => setRefs(upd(refs, i, { roas: e.target.value }))} />
                <input className="f" placeholder="수수료" value={r.commission ?? ""} onChange={(e) => setRefs(upd(refs, i, { commission: e.target.value }))} />
              </div>
              <input className="f" placeholder="이미지 URL" value={r.image_url ?? ""} onChange={(e) => setRefs(upd(refs, i, { image_url: e.target.value }))} />
              <input className="f" placeholder="콘텐츠 링크(틱톡 URL — 썸네일 클릭 시 이동)" value={r.url ?? ""} onChange={(e) => setRefs(upd(refs, i, { url: e.target.value }))} />
              <input className="f" placeholder="설명" value={r.desc ?? ""} onChange={(e) => setRefs(upd(refs, i, { desc: e.target.value }))} />
              <button className="btn sm" onClick={() => setRefs(refs.filter((_, j) => j !== i))} style={{ color: "#e03131", justifySelf: "start" }}>제거</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setRefs([...refs, {}])}>+ 레퍼런스 추가</button>
        </Card>
      </div>

      {/* ── 미리보기 ── */}
      <div style={{ position: "sticky", top: 12, maxHeight: "calc(100vh - 24px)", overflow: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
        <MktProposalView doc={preview} />
      </div>
    </div>
  );
}

function upd<T>(arr: T[], i: number, patch: Partial<T>): T[] {
  return arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card"><div className="hd"><b>{title}</b></div><div className="bd" style={{ display: "grid", gap: 6 }}>{children}</div></div>
  );
}
function L({ children }: { children: React.ReactNode }) {
  return <label className="f" style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--ink3)" }}>{children}</label>;
}
