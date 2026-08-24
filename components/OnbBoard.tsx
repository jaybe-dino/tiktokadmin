"use client";
// 온보딩 파이프라인 보드 — 드래그앤드롭으로 단계 수동 이동(brands.onb_stage_override).
//   카드 클릭 = 브랜드360 이동. 드래그 = 단계 변경. '자동' 배지 클릭으로 자동 파생 복귀.
//   맨 오른쪽 '보류' 섹터로 드래그하면 보관(hold) — 리스트는 접기/펼치기 가능.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OnbCard, OnbStageKey } from "@/lib/onboarding-pipeline";
import { setOnbStageAction } from "@/app/(dash)/onboarding-pipeline/actions";
import KanbanScroll from "@/components/KanbanScroll";

const STAGE_DOT: Record<string, string> = {
  invite: "#6366f1", company: "#0891b2", signup: "#16a34a", product: "#d97706", ready: "#7c3aed", hold: "#f59e0b",
};

type Stage = { key: OnbStageKey; label: string; slaDays: number | null; desc: string };
type Eff = OnbStageKey | "hold";

export default function OnbBoard({ stages, groups, held = [], ownerNames, owners = [] }: {
  stages: Stage[];
  groups: Record<OnbStageKey, OnbCard[]>;
  held?: OnbCard[];
  ownerNames: Record<string, string>;
  owners?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [ownerFilter, setOwnerFilter] = useState("");
  const [pending, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Eff | null>(null);
  const [msg, setMsg] = useState("");
  // 보류 리스트 접기(많이 쌓일 수 있어 기본 접힘) — localStorage 유지.
  const [holdCollapsed, setHoldCollapsed] = useState(true);
  useEffect(() => { try { const v = localStorage.getItem("onb-hold-collapsed"); if (v != null) setHoldCollapsed(v === "1"); } catch { /* noop */ } }, []);
  const toggleHold = () => setHoldCollapsed((c) => { const n = !c; try { localStorage.setItem("onb-hold-collapsed", n ? "1" : "0"); } catch { /* noop */ } return n; });
  // 낙관적 이동: 이동 즉시 카드를 옮겨 보여주고, 서버 확정 후 refresh.
  const [moved, setMoved] = useState<Record<string, Eff>>({});

  const nm = (id: string | null) => (id ? (ownerNames[id] ?? id) : null);
  const allCards = [...Object.values(groups).flat(), ...held];
  const effOf = (c: OnbCard): Eff => moved[c.brand_id] ?? (c.held ? "hold" : c.stage);

  function move(id: string, to: Eff) {
    const card = allCards.find((c) => c.brand_id === id);
    if (!card || effOf(card) === to) { setOverCol(null); setDragId(null); return; }
    setOverCol(null); setDragId(null);
    setMoved((m) => ({ ...m, [id]: to }));
    setMsg("");
    start(async () => {
      const r = await setOnbStageAction(id, to);
      if (!r.ok) { setMsg(r.error ?? "이동 실패"); setMoved((m) => { const n = { ...m }; delete n[id]; return n; }); return; }
      router.refresh();
    });
  }
  function resetAuto(id: string) {
    setMsg("");
    start(async () => {
      const r = await setOnbStageAction(id, null);
      if (!r.ok) { setMsg(r.error ?? "복귀 실패"); return; }
      setMoved((m) => { const n = { ...m }; delete n[id]; return n; });
      router.refresh();
    });
  }

  // 낙관적 이동 반영해 컬럼별 재분배(담당자 필터 적용).
  const cols: Record<OnbStageKey, OnbCard[]> = { invite: [], company: [], signup: [], product: [], ready: [] };
  const heldList: OnbCard[] = [];
  for (const c of allCards) {
    if (ownerFilter && c.owner_onboard !== ownerFilter) continue;
    const e = effOf(c);
    if (e === "hold") heldList.push(c);
    else cols[e].push(c);
  }

  function renderCard(c: OnbCard, inHold: boolean) {
    const owner = nm(c.owner_onboard);
    const isOverridden = !inHold && (c.overridden || (moved[c.brand_id] != null && moved[c.brand_id] !== "hold"));
    const st = stages.find((s) => s.key === c.stage);
    return (
      <div
        key={c.brand_id}
        draggable
        onDragStart={() => setDragId(c.brand_id)}
        onDragEnd={() => { setDragId(null); setOverCol(null); }}
        onClick={() => router.push(`/brand/${c.brand_id}`)}
        className="kcard"
        style={{ cursor: "grab", ...(c.overSla && !inHold ? { borderColor: "#fca5a5", background: "#fff5f5" } : {}), ...(inHold ? { opacity: 0.85 } : {}) }}
        title="드래그로 단계 이동 · 클릭으로 브랜드 열기"
      >
        <div className="nm" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{c.brand_name}</span>
          {inHold ? (
            <span
              onClick={(e) => { e.stopPropagation(); resetAuto(c.brand_id); }}
              title="보류 해제(자동 단계로 복귀)"
              style={{ fontSize: 9, fontWeight: 700, color: "#b45309", background: "#fef3c7", borderRadius: 5, padding: "1px 5px", cursor: "pointer" }}
            >보류 ✕</span>
          ) : isOverridden && (
            <span
              onClick={(e) => { e.stopPropagation(); resetAuto(c.brand_id); }}
              title="자동 단계로 복귀"
              style={{ fontSize: 9, fontWeight: 700, color: "#7c3aed", background: "#f3e8ff", borderRadius: 5, padding: "1px 5px", cursor: "pointer" }}
            >수동 ✕</span>
          )}
        </div>
        {inHold && st && <div className="mt" style={{ color: "var(--ink3)" }}>원단계: {st.label}</div>}
        {!inHold && c.stage === "invite" && !c.app_status && (
          <div className="mt" style={{ color: "#6366f1" }}>온보딩 계정(Invite) 발급 필요 →</div>
        )}
        {!inHold && c.app_status && <div className="mt truncate">신청상태: {c.app_status}{c.product_count ? ` · 제품 ${c.product_count}` : ""}</div>}
        <div className="ft">
          {owner ? <span className="av" title={`온보딩 ${owner}`}>{owner.slice(0, 2)}</span>
            : <><span className="av" style={{ background: "#94a3b8" }}>미</span><span style={{ fontSize: 10, color: "var(--danger)", fontWeight: 700 }}>담당 미배정</span></>}
          {!inHold && st?.slaDays != null && (
            <span className={`sla ${c.overSla ? "t2" : c.ageDays >= st.slaDays - 1 ? "t1" : "ok"}`}>
              {c.overSla ? `+${c.ageDays - st.slaDays}일` : `D${c.ageDays}`}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {owners.length > 0 && (
        <div className="bar" style={{ margin: "0 0 10px" }}>
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} title="온보딩 담당자별 보기">
            <option value="">담당자 전체</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}
      {msg && <div className="note" style={{ marginBottom: 8, color: "var(--danger)" }}>{msg}</div>}
      <KanbanScroll>
      <div className="kb">
        {stages.map((st) => {
          const list = cols[st.key] ?? [];
          return (
            <div
              key={st.key}
              className={`kcol ${overCol === st.key ? "dragover" : ""}`}
              onDragOver={(e) => { e.preventDefault(); if (overCol !== st.key) setOverCol(st.key); }}
              onDragLeave={() => setOverCol((o) => (o === st.key ? null : o))}
              onDrop={() => dragId && move(dragId, st.key)}
            >
              <h4>
                <span className="dot" style={{ background: STAGE_DOT[st.key] }} />
                {st.label}
                <span className="c">{list.length}{st.slaDays != null && ` · SLA ${st.slaDays}일`}</span>
              </h4>
              <div style={{ fontSize: 10.5, color: "var(--ink3)", padding: "0 2px 6px" }}>{st.desc}</div>
              <div className="min-h-[60px]">
                {list.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--ink3)", padding: 8, textAlign: "center" }}>
                    {overCol === st.key ? "여기로 이동" : "없음"}
                  </div>
                )}
                {list.map((c) => renderCard(c, false))}
              </div>
            </div>
          );
        })}

        {/* 보류 섹터 — 맨 오른쪽. 많이 쌓일 수 있어 리스트 접기/펼치기. */}
        <div
          className={`kcol ${overCol === "hold" ? "dragover" : ""}`}
          style={{ background: "#fffbeb", borderColor: "#fde68a" }}
          onDragOver={(e) => { e.preventDefault(); if (overCol !== "hold") setOverCol("hold"); }}
          onDragLeave={() => setOverCol((o) => (o === "hold" ? null : o))}
          onDrop={() => dragId && move(dragId, "hold")}
        >
          <h4>
            <span className="dot" style={{ background: STAGE_DOT.hold }} />
            보류
            <span className="c">{heldList.length}</span>
            <button
              onClick={toggleHold}
              title={holdCollapsed ? "보류 목록 펼치기" : "보류 목록 접기"}
              style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "var(--acc)", fontWeight: 700 }}
            >{holdCollapsed ? "펼치기 ▸" : "접기 ▾"}</button>
          </h4>
          <div style={{ fontSize: 10.5, color: "var(--ink3)", padding: "0 2px 6px" }}>진행 보류 — 여기로 드래그해 보관, ✕ 로 복귀</div>
          <div className="min-h-[60px]">
            {heldList.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--ink3)", padding: 8, textAlign: "center" }}>
                {overCol === "hold" ? "여기로 이동" : "보류 없음"}
              </div>
            )}
            {holdCollapsed && heldList.length > 0 ? (
              <div style={{ fontSize: 12, color: "var(--ink3)", padding: 8, textAlign: "center" }}>
                {heldList.length}건 보류 중 · <button onClick={toggleHold} style={{ border: "none", background: "none", color: "var(--acc)", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>목록 보기</button>
              </div>
            ) : (
              heldList.map((c) => renderCard(c, true))
            )}
          </div>
        </div>
      </div>
      </KanbanScroll>
      {pending && <div className="note" style={{ marginTop: 6, color: "var(--ink3)" }}>저장 중…</div>}
    </>
  );
}
