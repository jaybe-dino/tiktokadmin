"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MktProposalView from "@/components/MktProposalView";
import { COUNTRY_LABEL, type MktCountry } from "@/lib/mkt-proposal-engine";
import type { MktProposalDocRow, MktProductItem, MktReferenceItem } from "@/lib/mkt-proposal-doc";
import { saveMktProposalDocAction, deleteMktProposalDocAction, linkMktProposalToPipelineAction } from "../actions";

const MAN = 10000;
const toMan = (won: number) => Math.round((won || 0) / MAN);
const COUNTRIES: MktCountry[] = ["US", "TH", "VN"];

export default function MktProposalEditor({ doc, brands }: { doc: MktProposalDocRow; brands: { id: string; brand_name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const [brandId, setBrandId] = useState(doc.brand_id ?? "");
  const [title, setTitle] = useState(doc.title);
  const [subtitle, setSubtitle] = useState(doc.subtitle);
  const [status, setStatus] = useState(doc.status);
  const [accent, setAccent] = useState(doc.accent || "#111111");
  const [countries, setCountries] = useState<string[]>(doc.countries?.length ? doc.countries : ["US"]);
  const [startMonth, setStartMonth] = useState(doc.start_month);
  const [months, setMonths] = useState(doc.months);
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

  function toggleCountry(c: string) {
    setCountries((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }

  // 미리보기용 doc 재조립(만원 → 원).
  const preview: MktProposalDocRow = {
    ...doc, brand_id: brandId || null, title, subtitle, status, accent,
    countries: countries.length ? countries : ["US"], start_month: startMonth, months,
    monthly_budget: monthlyMan * MAN, operation_fee: opFeeMan * MAN,
    gmv_reserve_min: gmvMinMan * MAN, gmv_reserve_max: gmvMaxMan * MAN,
    first_month_seeding: firstSeed, commission_pct: commission,
    goal_first: goalFirst, goal_final: goalFinal, intro_note: intro,
    products_json: products, references_json: refs,
    brand_name: brands.find((b) => b.id === brandId)?.brand_name ?? doc.brand_name,
  };

  function save(after?: "pipeline") {
    setMsg("");
    start(async () => {
      const r = await saveMktProposalDocAction({
        id: doc.id, brand_id: brandId || null, title, subtitle, status, accent,
        countries, start_month: startMonth, months,
        monthly_budget: monthlyMan * MAN, operation_fee: opFeeMan * MAN,
        gmv_reserve_min: gmvMinMan * MAN, gmv_reserve_max: gmvMaxMan * MAN,
        first_month_seeding: firstSeed, commission_pct: commission,
        goal_first: goalFirst, goal_final: goalFinal, intro_note: intro,
        products_json: products, references_json: refs,
      });
      if (!r.ok) { setMsg(r.error ?? "저장 실패"); return; }
      if (after === "pipeline") {
        const lr = await linkMktProposalToPipelineAction(doc.id);
        setMsg(lr.ok ? "저장 + 파이프라인 연동 완료 — /mkt 에서 카드로 표시됩니다." : lr.error ?? "연동 실패");
      } else setMsg("저장되었습니다.");
      router.refresh();
    });
  }
  function del() {
    if (!confirm("이 마케팅 제안서를 삭제할까요?")) return;
    start(async () => {
      const r = await deleteMktProposalDocAction(doc.id);
      if (r.ok) router.push("/mkt-proposals"); else setMsg(r.error ?? "삭제 실패");
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 16, alignItems: "start" }}>
      {/* ── 편집 ── */}
      <div style={{ display: "grid", gap: 12 }}>
        <div className="bar" style={{ margin: 0 }}>
          <Link href="/mkt-proposals" className="btn sm">← 목록</Link>
          <a href={`/mkt-proposal/${doc.token}`} target="_blank" rel="noreferrer" className="btn sm">미리보기 ↗</a>
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
          </div>
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
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><L>시작 월</L>
              <select className="f" value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}><L>개월</L><input className="f" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(Number(e.target.value))} /></div>
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

        <Card title="목표">
          <L>1차 목표</L><input className="f" value={goalFirst} onChange={(e) => setGoalFirst(e.target.value)} placeholder="T1 기준 콘텐츠 204건 달성" />
          <L>최종 목표</L><input className="f" value={goalFinal} onChange={(e) => setGoalFinal(e.target.value)} placeholder="T2 진입·판매 기반 확립" />
          <L>서문(선택)</L><textarea className="f" rows={2} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </Card>

        <Card title={`제품 (${products.length})`}>
          {products.map((p, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, marginBottom: 6, display: "grid", gap: 4 }}>
              <input className="f" placeholder="제품명" value={p.name} onChange={(e) => setProducts(upd(products, i, { name: e.target.value }))} />
              <div style={{ display: "flex", gap: 6 }}>
                <input className="f" placeholder="영문명" value={p.name_en ?? ""} onChange={(e) => setProducts(upd(products, i, { name_en: e.target.value }))} />
                <input className="f" placeholder="용량" value={p.volume ?? ""} onChange={(e) => setProducts(upd(products, i, { volume: e.target.value }))} style={{ width: 90 }} />
              </div>
              <input className="f" placeholder="이미지 URL" value={p.image_url ?? ""} onChange={(e) => setProducts(upd(products, i, { image_url: e.target.value }))} />
              <textarea className="f" rows={2} placeholder="특징(줄바꿈으로 구분)" value={(p.features ?? []).join("\n")} onChange={(e) => setProducts(upd(products, i, { features: e.target.value.split("\n") }))} />
              <button className="btn sm" onClick={() => setProducts(products.filter((_, j) => j !== i))} style={{ color: "#e03131", justifySelf: "start" }}>제거</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setProducts([...products, { name: "", features: [] }])}>+ 제품 추가</button>
        </Card>

        <Card title={`레퍼런스 (${refs.length})`}>
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
