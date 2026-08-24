"use client";
// 온보딩 파이프라인 보드 — 드래그앤드롭으로 단계 수동 이동(brands.onb_stage_override).
//   카드 클릭 = 브랜드360 이동. 드래그 = 단계 변경. '자동' 배지 클릭으로 자동 파생 복귀.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OnbCard, OnbStageKey } from "@/lib/onboarding-pipeline";
import { setOnbStageAction } from "@/app/(dash)/onboarding-pipeline/actions";
import KanbanScroll from "@/components/KanbanScroll";

const STAGE_DOT: Record<string, string> = {
  invite: "#6366f1", company: "#0891b2", signup: "#16a34a", product: "#d97706", ready: "#7c3aed",
};

type Stage = { key: OnbStageKey; label: string; slaDays: number | null; desc: string };

export default function OnbBoard({ stages, groups, ownerNames, owners = [] }: {
  stages: Stage[];
  groups: Record<OnbStageKey, OnbCard[]>;
  ownerNames: Record<string, string>;
  owners?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [ownerFilter, setOwnerFilter] = useState("");
  const [pending, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<OnbStageKey | null>(null);
  const [msg, setMsg] = useState("");
  // 낙관적 이동: 이동 즉시 카드를 옮겨 보여주고, 서버 확정 후 refresh.
  const [moved, setMoved] = useState<Record<string, OnbStageKey>>({});

  const nm = (id: string | null) => (id ? (ownerNames[id] ?? id) : null);
  const stageOf = (c: OnbCard): OnbStageKey => moved[c.brand_id] ?? c.stage;

  function drop(col: OnbStageKey) {
    const id = dragId;
    setOverCol(null); setDragId(null);
    if (!id) return;
    const card = Object.values(groups).flat().find((c) => c.brand_id === id);
    if (!card || stageOf(card) === col) return;
    setMoved((m) => ({ ...m, [id]: col }));
    setMsg("");
    start(async () => {
      const r = await setOnbStageAction(id, col);
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
  for (const c of Object.values(groups).flat()) {
    if (ownerFilter && c.owner_onboard !== ownerFilter) continue;
    cols[stageOf(c)].push(c);
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
              onDrop={() => drop(st.key)}
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
                {list.map((c) => {
                  const owner = nm(c.owner_onboard);
                  const isOverridden = c.overridden || moved[c.brand_id] != null;
                  return (
                    <div
                      key={c.brand_id}
                      draggable
                      onDragStart={() => setDragId(c.brand_id)}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      onClick={() => router.push(`/brand/${c.brand_id}`)}
                      className="kcard"
                      style={{ cursor: "grab", ...(c.overSla ? { borderColor: "#fca5a5", background: "#fff5f5" } : {}) }}
                      title="드래그로 단계 이동 · 클릭으로 브랜드 열기"
                    >
                      <div className="nm" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{c.brand_name}</span>
                        {isOverridden && (
                          <span
                            onClick={(e) => { e.stopPropagation(); resetAuto(c.brand_id); }}
                            title="자동 단계로 복귀"
                            style={{ fontSize: 9, fontWeight: 700, color: "#7c3aed", background: "#f3e8ff", borderRadius: 5, padding: "1px 5px", cursor: "pointer" }}
                          >수동 ✕</span>
                        )}
                      </div>
                      {st.key === "invite" && !c.app_status && (
                        <div className="mt" style={{ color: "#6366f1" }}>온보딩 계정(Invite) 발급 필요 →</div>
                      )}
                      {c.app_status && <div className="mt truncate">신청상태: {c.app_status}{c.product_count ? ` · 제품 ${c.product_count}` : ""}</div>}
                      <div className="ft">
                        {owner ? <span className="av" title={`온보딩 ${owner}`}>{owner.slice(0, 2)}</span>
                          : <><span className="av" style={{ background: "#94a3b8" }}>미</span><span style={{ fontSize: 10, color: "var(--danger)", fontWeight: 700 }}>담당 미배정</span></>}
                        {st.slaDays != null && (
                          <span className={`sla ${c.overSla ? "t2" : c.ageDays >= st.slaDays - 1 ? "t1" : "ok"}`}>
                            {c.overSla ? `+${c.ageDays - st.slaDays}일` : `D${c.ageDays}`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </KanbanScroll>
      {pending && <div className="note" style={{ marginTop: 6, color: "var(--ink3)" }}>저장 중…</div>}
    </>
  );
}
