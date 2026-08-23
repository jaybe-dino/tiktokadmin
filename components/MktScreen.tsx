"use client";
import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignBrandOwnerAction } from "@/app/actions";
import Link from "next/link";
import {
  createMktProjectAction,
  createMktProposalAction,
  createProposalForProjectAction,
  deleteMktProjectAction,
  draftMktProposalEmailAction,
  registerMktBrandAction,
  setMktProposalStatusAction,
  setMktStatusAction,
  updateMktProjectAction,
  pullRfpFromSurveyAction,
  generateDirectionDraftAction,
  regenerateDirectionAction,
  updateMktProposalMetaAction,
  setRoutineContractAction,
  addRoutineCycleAction,
  setRoutineCycleStageAction,
  updateRoutineCycleAction,
  deleteRoutineCycleAction,
} from "@/app/(dash)/mkt/actions";
import { ROUTINE_STAGES, type RoutineProject, type RoutineCycle } from "@/lib/mkt-routine-types";

// 마케팅 프로젝트 화면 — 프로토타입 s-mkt 3탭 구성(파이프라인 / 루틴 운영대행 / 브랜드사별 매핑).
// 데이터는 서버(allMktProjects)에서 내려온 실데이터만 사용한다.
export interface MktRow {
  id: string;
  title: string;
  kind: string; // 'project' | 'routine'
  proposal_status: string; // draft|sent|negotiating|won|dropped
  note: string | null;
  brand_name: string;
  brand_id: string;
  // 연결된 마케팅 제안서(proposal_id) — 없으면 null
  proposal_id: string | null;
  prop_title: string | null;
  prop_amount: number | null;
  prop_status: string | null;
  prop_url: string | null;
  prop_propose_date?: string | null;   // 제안 예정일(연결 제안서)
  prop_period_start?: string | null;
  prop_period_end?: string | null;
  prop_rfp_text?: string | null;
  prop_rfp_file_url?: string | null;
  prop_ai_direction?: string | null;
}

// 마케팅 제안서 행 (proposals kind='marketing' + 초안함 연결)
export interface MktProposalRow {
  id: string;
  title: string;
  amount: number | null;
  status: string; // draft|sent|accepted|rejected
  note: string | null;
  url: string | null;  // 개별 제안서 파일 링크
  period_start: string | null;
  period_end: string | null;
  sent_at: string | null;
  created_at: string;
  brand_name: string;
  brand_id: string;
  /** 연결된 최신 발송 초안(email_drafts) 상태: draft|approved|sent|discarded */
  draft_status: string | null;
  draft_sent_at: string | null;
  /** 연결된 파이프라인 프로젝트(mkt_projects) — 없으면 null */
  project_id: string | null;
  project_status: string | null;
  // 고도화(0064): 제안 예정일·최종 일정·RFP·AI 제안방향
  propose_date?: string | null;
  final_due_date?: string | null;
  rfp_text?: string | null;
  rfp_file_url?: string | null;
  ai_direction?: string | null;
}

export interface MktBrandOpt {
  id: string;
  name: string;
  contract_type: string | null;
}

// proposal_status → 라벨 · .cellchip 색상
const ST: Record<string, { ko: string; cc: string }> = {
  draft: { ko: "작성 중", cc: "cc-ing" },
  sent: { ko: "발송", cc: "cc-warn" },
  negotiating: { ko: "협의 중", cc: "cc-warn" },
  meeting_scheduled: { ko: "미팅 예정", cc: "cc-warn" },
  won: { ko: "수주", cc: "cc-ok" },
  dropped: { ko: "드랍", cc: "cc-no" },
};

// 파이프라인 열 (project 트랙)
const PIPE: { key: string; label: string; dot: string }[] = [
  { key: "draft", label: "제안 작성 중", dot: "var(--sales)" },
  { key: "sent", label: "발송·협의", dot: "var(--warn)" },
  { key: "negotiating", label: "협의 중", dot: "var(--warn)" },
  { key: "meeting_scheduled", label: "미팅 예정", dot: "var(--warn)" },
  { key: "won", label: "수주·계약", dot: "var(--ok)" },
  { key: "dropped", label: "완료·드랍", dot: "#64748b" },
];

type Tab = "pipe" | "routine" | "map" | "prop";

export default function MktScreen({
  rows,
  proposals = [],
  brands = [],
  routineData = [],
  owners = [],
}: {
  rows: MktRow[];
  proposals?: MktProposalRow[];
  brands?: MktBrandOpt[];
  routineData?: RoutineProject[];
  owners?: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<Tab>("pipe");
  const projects = rows.filter((r) => r.kind !== "routine");

  return (
    <div>
      <div className="tabs">
        <button className={tab === "pipe" ? "on" : ""} onClick={() => setTab("pipe")}>
          개별 프로젝트 — 파이프라인 보드
        </button>
        <button className={tab === "routine" ? "on" : ""} onClick={() => setTab("routine")}>
          루틴 운영대행 (시딩·라이브)
        </button>
        <button className={tab === "prop" ? "on" : ""} onClick={() => setTab("prop")}>
          마케팅 제안서 {proposals.length > 0 ? `(${proposals.length})` : ""}
        </button>
        <button className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>
          브랜드사별 매핑
        </button>
      </div>

      {tab === "pipe" && <Pipeline projects={projects} brands={brands} owners={owners} onGoProposals={() => setTab("prop")} />}
      {tab === "routine" && <Routine projects={routineData} brands={brands} />}
      {tab === "prop" && <Proposals proposals={proposals} brands={brands} projects={rows} />}
      {tab === "map" && <BrandMap rows={rows} />}
    </div>
  );
}

// ── 탭 1: 파이프라인 보드 ─────────────────────────────────────
function Pipeline({ projects, brands = [], owners = [], onGoProposals }: { projects: MktRow[]; brands?: MktBrandOpt[]; owners?: { id: string; name: string }[]; onGoProposals: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  // 드래그앤드랍 이동 상태
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [moveMsg, setMoveMsg] = useState("");
  // 뷰 전환(파이프라인/표) + 표 일괄편집 상태
  const [view, setView] = useState<"board" | "table">("board");
  useEffect(() => { try { const v = localStorage.getItem("mkt-pipeline-view"); if (v === "table" || v === "board") setView(v); } catch { /* noop */ } }, []);
  const pickView = (v: "board" | "table") => { setView(v); try { localStorage.setItem("mkt-pipeline-view", v); } catch { /* noop */ } };
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProg, setBulkProg] = useState<{ done: number; total: number } | null>(null);
  const kw = q.trim().toLowerCase();
  const filtered = kw
    ? projects.filter(
        (r) =>
          r.title.toLowerCase().includes(kw) ||
          r.brand_name.toLowerCase().includes(kw) ||
          (r.note ?? "").toLowerCase().includes(kw),
      )
    : projects;
  const count = (k: string) => filtered.filter((r) => r.proposal_status === k).length;
  // 드롭 → 상태 이동(게이트 검증). 같은 열이면 무시.
  function dropTo(colKey: string) {
    const id = dragId;
    setDragId(null); setOverCol(null);
    if (!id) return;
    const card = projects.find((r) => r.id === id);
    if (!card || card.proposal_status === colKey) return;
    setMoveMsg("");
    start(async () => {
      const r = await setMktStatusAction(id, colKey);
      if (r.ok) router.refresh();
      else { setMoveMsg(r.error ?? "이동 실패"); setTimeout(() => setMoveMsg(""), 3200); }
    });
  }
  // 표 뷰 일괄편집.
  const ids = filtered.map((r) => r.id);
  const allChecked = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(ids));
  const ownerName = (id: string) => owners.find((o) => o.id === id)?.name ?? id;
  async function runBulk(fn: (r: MktRow) => Promise<{ ok: boolean }>, doneMsg: (ok: number, fail: number) => string) {
    if (sel.size === 0 || bulkBusy) return;
    const list = filtered.filter((r) => sel.has(r.id));
    setBulkBusy(true); setMoveMsg(""); setBulkProg({ done: 0, total: list.length });
    let ok = 0, fail = 0;
    for (let i = 0; i < list.length; i++) {
      try { const r = await fn(list[i]); r.ok ? ok++ : fail++; } catch { fail++; }
      setBulkProg({ done: i + 1, total: list.length });
    }
    setBulkBusy(false); setBulkProg(null); setSel(new Set());
    setMoveMsg(doneMsg(ok, fail)); setTimeout(() => setMoveMsg(""), 3600);
    router.refresh();
  }
  const doBulkStage = () => {
    if (!bulkStage) return;
    const label = PIPE.find((p) => p.key === bulkStage)?.label ?? bulkStage;
    runBulk((r) => setMktStatusAction(r.id, bulkStage), (ok, fail) => `${ok}건 '${label}'로 이동${fail ? ` · ${fail}건 실패(게이트/오류)` : ""}`);
  };
  const doBulkOwner = () => {
    if (!bulkOwner) return;
    runBulk((r) => r.brand_id ? assignBrandOwnerAction(r.brand_id, "owner_ads", bulkOwner) : Promise.resolve({ ok: false }),
      (ok, fail) => `${ok}건 마케팅 담당 '${ownerName(bulkOwner)}' 배정${fail ? ` · ${fail}건 실패(브랜드 미연결 등)` : ""}`);
  };
  return (
    <div>
      <div className="bar">
        {PIPE.map((c) => (
          <span key={c.key} className={`chip ${c.key === "won" ? "grn" : c.key === "dropped" ? "" : c.key === "draft" ? "" : "amb"}`}>
            {c.label} {count(c.key)}
          </span>
        ))}
        <div style={{ marginLeft: "auto", display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          <button className="btn sm" onClick={() => pickView("board")} style={{ borderRadius: 0, border: "none", background: view === "board" ? "var(--acc)" : "#fff", color: view === "board" ? "#fff" : "var(--ink2)", fontWeight: 700 }}>▦ 파이프라인</button>
          <button className="btn sm" onClick={() => pickView("table")} style={{ borderRadius: 0, border: "none", borderLeft: "1px solid var(--line)", background: view === "table" ? "var(--acc)" : "#fff", color: view === "table" ? "#fff" : "var(--ink2)", fontWeight: 700 }}>▤ 표(일괄)</button>
        </div>
        <button className="btn sm pri" onClick={onGoProposals} title="마케팅 제안서 작성 화면으로 이동(제안서 저장 시 프로젝트가 자동 생성·연결됩니다)">
          + 신규 프로젝트
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="프로젝트·브랜드 검색"
        />
        <span style={{ color: "var(--ink3)", fontSize: "11.5px" }}>
          수주→진행은 계약 등록이 필요합니다 — 카드 이동도 게이트 검증
        </span>
      </div>
      {view === "table" ? (
        <div className="card" style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--ink3)" }}>{sel.size > 0 ? `${sel.size}건 선택됨` : "행 체크로 선택"}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select className="f" style={{ width: 130, padding: "3px 6px", fontSize: 12 }} value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)}>
                <option value="">담당자 선택</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button className="btn btn-sm btn-primary" disabled={bulkBusy || sel.size === 0 || !bulkOwner} onClick={doBulkOwner}>담당 배정{sel.size ? ` (${sel.size})` : ""}</button>
              <select className="f" style={{ width: 130, padding: "3px 6px", fontSize: 12 }} value={bulkStage} onChange={(e) => setBulkStage(e.target.value)}>
                <option value="">단계 이동…</option>
                {PIPE.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <button className="btn btn-sm" disabled={bulkBusy || sel.size === 0 || !bulkStage} onClick={doBulkStage}>단계 이동{sel.size ? ` (${sel.size})` : ""}</button>
            </div>
          </div>
          {bulkProg && (
            <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, height: 8, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${bulkProg.total ? Math.round((bulkProg.done / bulkProg.total) * 100) : 0}%`, height: "100%", background: "var(--acc)", transition: "width .15s" }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)", whiteSpace: "nowrap" }}>{bulkProg.done}/{bulkProg.total} ({bulkProg.total ? Math.round((bulkProg.done / bulkProg.total) * 100) : 0}%)</span>
            </div>
          )}
          <table className="t">
            <thead><tr>
              <th style={{ width: 28 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="전체 선택" /></th>
              <th>프로젝트 / 브랜드</th><th>단계</th><th>제안서</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={4} style={{ padding: "24px 12px", textAlign: "center", color: "var(--ink3)" }}>{projects.length === 0 ? "진행 중인 프로젝트 없음" : `「${q}」 결과 없음`}</td></tr>}
              {filtered.map((m) => {
                const checked = sel.has(m.id);
                return (
                  <tr key={m.id} style={{ background: checked ? "rgba(37,99,235,.08)" : undefined }}>
                    <td><input type="checkbox" checked={checked} onChange={() => toggle(m.id)} /></td>
                    <td><b>{m.title}</b><span className="sub">{m.brand_name}</span></td>
                    <td><span className={`cellchip ${ST[m.proposal_status]?.cc ?? "cc-no"}`}>{ST[m.proposal_status]?.ko ?? m.proposal_status}</span></td>
                    <td style={{ fontSize: 12, color: "var(--ink3)" }}>{m.proposal_id ? "📄 연결됨" : "미연결"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : projects.length === 0 ? (
        <div className="note">진행 중인 개별 프로젝트가 없습니다. RFP 접수·인바운드 문의가 등록되면 여기에 카드로 표시됩니다.</div>
      ) : filtered.length === 0 ? (
        <div className="note">「{q}」 검색 결과가 없습니다.</div>
      ) : (
        <div className="kb">
          {PIPE.map((col) => {
            const list = filtered.filter((r) => r.proposal_status === col.key);
            return (
              <div
                key={col.key}
                className={`kcol${overCol === col.key ? " dragover" : ""}`}
                onDragOver={(e) => { e.preventDefault(); if (overCol !== col.key) setOverCol(col.key); }}
                onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
                onDrop={() => dropTo(col.key)}
              >
                <h4>
                  <span className="dot" style={{ background: col.dot }} />
                  {col.label} <span className="c">{list.length}</span>
                </h4>
                {list.map((m) => (
                  <KCard key={m.id} m={m} brands={brands} onDragStart={() => setDragId(m.id)} onDragEnd={() => { setDragId(null); setOverCol(null); }} dragging={dragId === m.id} />
                ))}
                {list.length === 0 && <div className="mt" style={{ padding: "2px 4px" }}>—</div>}
              </div>
            );
          })}
        </div>
      )}
      {moveMsg && <div className="note" style={{ marginTop: 8, color: "var(--bad)" }}>⚠ {moveMsg}</div>}
      <div className="note" style={{ marginTop: 8 }}>
        💡 카드를 드래그해 단계 이동 · 완료 프로젝트 성과(GMV·콘텐츠)는 다음 제안 근거로 자동 축적 · 수주 이동은 계약 등록 필요
      </div>
    </div>
  );
}

// 파이프라인 카드 — 드래그로 단계 이동, 클릭하면 상세 편집·제안서 연결 관리 모달.
function KCard({ m, brands = [], onDragStart, onDragEnd, dragging }: { m: MktRow; brands?: MktBrandOpt[]; onDragStart?: () => void; onDragEnd?: () => void; dragging?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="kcard"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={{ cursor: "grab", opacity: dragging ? 0.5 : 1 }}
        onClick={() => setOpen(true)}
        title="드래그로 이동 · 클릭하여 상세 편집"
      >
        <div className="nm">{m.title}</div>
        <div className="mt">{m.brand_name}{m.note ? ` · ${m.note}` : ""}</div>
        {(m.prop_propose_date || m.prop_amount != null) && (
          <div style={{ fontSize: 10.5, color: "var(--ink3)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {m.prop_propose_date && <span>📅 제안 {m.prop_propose_date}</span>}
            {m.prop_amount != null && <span>{m.prop_amount.toLocaleString("ko-KR")}원</span>}
          </div>
        )}
        <div className="ft" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className={`cellchip ${ST[m.proposal_status]?.cc ?? "cc-no"}`}>{ST[m.proposal_status]?.ko ?? m.proposal_status}</span>
          {m.proposal_id
            ? <span className="cellchip cc-ing" title="마케팅 제안서 연결됨">📄 제안서</span>
            : <span className="cellchip cc-no" title="연결된 제안서 없음">제안서 미연결</span>}
        </div>
      </div>
      {open && <MktProjectDetail m={m} brands={brands} onClose={() => setOpen(false)} />}
    </>
  );
}

// 프로젝트 상세 모달 — 제목·메모 편집, 상태 이동(게이트), 연결된 마케팅 제안서 관리.
function MktProjectDetail({ m, brands = [], onClose }: { m: MktRow; brands?: MktBrandOpt[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(m.title);
  const [note, setNote] = useState(m.note ?? "");
  const [status, setStatus] = useState(m.proposal_status);
  const [msg, setMsg] = useState("");
  const [editProp, setEditProp] = useState(false);
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2600); };

  function saveInfo() {
    start(async () => {
      const r = await updateMktProjectAction({ id: m.id, title, note });
      if (r.ok) { flash("저장됨"); router.refresh(); } else flash(r.error ?? "저장 실패");
    });
  }
  function changeStatus(to: string) {
    if (to === status) return;
    start(async () => {
      const r = await setMktStatusAction(m.id, to);
      if (r.ok) { setStatus(to); flash("상태 변경됨"); router.refresh(); } else flash(r.error ?? "변경 실패");
    });
  }
  function linkProposal() {
    start(async () => {
      const r = await createProposalForProjectAction(m.id);
      if (r.ok) { flash("마케팅 제안서를 생성해 연결했습니다."); router.refresh(); }
      else flash(r.error ?? "연결 실패");
    });
  }
  function removeProject() {
    if (!confirm(`'${m.title}' 프로젝트를 삭제할까요? 세부 내용이 모두 제거됩니다.`)) return;
    start(async () => {
      const r = await deleteMktProjectAction(m.id);
      if (r.ok) { onClose(); router.refresh(); } else flash(r.error ?? "삭제 실패");
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 100, display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(560px, 96vw)", maxHeight: "90vh", overflow: "auto", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <b style={{ fontSize: 15 }}>프로젝트 상세</b>
          <Link href={`/brand/${m.brand_id}`} className="chip" style={{ fontSize: 11 }}>{m.brand_name} ↗</Link>
          <button className="btn sm" style={{ marginLeft: "auto", color: "var(--bad)" }} disabled={pending} onClick={removeProject}>🗑 삭제</button>
          <button className="btn sm" onClick={onClose}>닫기 ✕</button>
        </div>

        <label className="f">프로젝트명</label>
        <input className="f" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
        <label className="f" style={{ marginTop: 10 }}>메모</label>
        <textarea className="f" value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <label className="f" style={{ margin: 0 }}>단계</label>
          <select className="f" value={status} onChange={(e) => changeStatus(e.target.value)} disabled={pending}>
            {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.ko}</option>)}
          </select>
          <button className="btn sm pri" disabled={pending} onClick={saveInfo} style={{ marginLeft: "auto" }}>제목·메모 저장</button>
        </div>

        {/* 연결된 마케팅 제안서 */}
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>연결된 마케팅 제안서</div>
          {m.proposal_id ? (
            <div className="card" style={{ padding: 12, background: "var(--tint, #fafafa)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 600 }}>{m.prop_title || "(제목 없음)"}</div>
                <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setEditProp(true)}>✏️ 제안 항목 편집</button>
              </div>
              <div className="sub" style={{ marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span className={`cellchip ${PROP_ST[m.prop_status ?? "draft"]?.cc ?? "cc-ing"}`}>{PROP_ST[m.prop_status ?? "draft"]?.ko ?? m.prop_status}</span>
                {m.prop_propose_date && <span>📅 제안 {m.prop_propose_date}</span>}
                {m.prop_amount != null && <span>{m.prop_amount.toLocaleString("ko-KR")}원</span>}
                {m.prop_url && <a href={m.prop_url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>📎 제안서 파일 ↗</a>}
              </div>
              {m.prop_ai_direction && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--acc)" }}>🤖 AI 제안방향</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.5, fontFamily: "inherit", color: "var(--ink2)", marginTop: 4 }}>{m.prop_ai_direction}</pre>
                </details>
              )}
              <div className="note" style={{ marginTop: 8, fontSize: 11 }}>제안서 발송·수락/거절은 「마케팅 제안서」 탭에서 관리 — 상태는 프로젝트에 자동 반영됩니다.</div>
            </div>
          ) : (
            <div className="note" style={{ fontSize: 12 }}>
              연결된 제안서가 없습니다. <b>「마케팅 제안서」 탭</b>에서 이 브랜드로 제안서를 작성하면(‘파이프라인 프로젝트로 등록’ 체크) 자동으로 연결됩니다.
              <div style={{ marginTop: 6 }}><button className="btn sm" disabled={pending} onClick={linkProposal}>안내</button></div>
            </div>
          )}
        </div>
        {msg && <div className="note" style={{ marginTop: 10 }}>{msg}</div>}
      </div>

      {editProp && m.proposal_id && (
        <ProposalEditModal
          p={{
            id: m.proposal_id, brand_id: m.brand_id, brand_name: m.brand_name, title: m.prop_title || m.title,
            amount: m.prop_amount ?? null, propose_date: m.prop_propose_date ?? null,
            period_start: m.prop_period_start ?? null, period_end: m.prop_period_end ?? null,
            rfp_text: m.prop_rfp_text ?? null, rfp_file_url: m.prop_rfp_file_url ?? null, ai_direction: m.prop_ai_direction ?? null,
          }}
          brands={brands}
          onClose={() => setEditProp(false)}
        />
      )}
    </div>
  );
}

// ── 탭 2: 루틴 운영대행 — 계약 기간 + 매월 되돌이 회차(칸반) ─────
function thisYm(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function Routine({ projects, brands }: { projects: RoutineProject[]; brands: MktBrandOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [cs, setCs] = useState("");
  const [ce, setCe] = useState("");
  const [msg, setMsg] = useState("");

  function createRoutine() {
    setMsg("");
    start(async () => {
      const r = await createMktProjectAction({ brand_id: brandId, title: title.trim() || "마케팅 운영대행", kind: "routine" });
      if (!r.ok || !r.id) { setMsg(r.error ?? "등록 실패"); return; }
      if (cs || ce) await setRoutineContractAction(r.id, cs, ce);
      setOpen(false); setTitle(""); setCs(""); setCe(""); router.refresh();
    });
  }

  return (
    <div>
      <div className="bar">
        <span className="chip grn">운영대행 계약 {projects.length}건</span>
        <button className="btn sm pri" onClick={() => setOpen((o) => !o)}>{open ? "취소" : "+ 루틴 운영대행 등록"}</button>
        <span style={{ marginLeft: "auto", color: "var(--ink3)", fontSize: "11.5px" }}>
          계약 기간 · 매월 회차(기획→진행→리포트→완료·정산) · 완료 시 다음 달 자동 개설(되돌이표)
        </span>
      </div>
      {open && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="bd" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <div><label className="f">브랜드</label>
              <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ minWidth: 160 }}>
                {brands.length === 0 && <option value="">브랜드 없음</option>}
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}><label className="f">계약명</label>
              <input className="f" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 시딩·라방 월 운영대행" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div><label className="f">계약 시작</label><input className="f" type="date" value={cs} onChange={(e) => setCs(e.target.value)} /></div>
            <div><label className="f">계약 종료</label><input className="f" type="date" value={ce} onChange={(e) => setCe(e.target.value)} /></div>
            <button className="btn pri" disabled={pending || !brandId} onClick={createRoutine}>{pending ? "등록 중…" : "등록"}</button>
            {msg && <span className="chip red" style={{ fontSize: 11 }}>{msg}</span>}
          </div>
        </div>
      )}
      {projects.length === 0 ? (
        <div className="note">루틴 운영대행 프로젝트가 없습니다. 「개별 프로젝트/제안서」에서 루틴(운영대행) 계약을 등록하면 여기에 표시됩니다.</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {projects.map((p) => <RoutineCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}

function RoutineCard({ p }: { p: RoutineProject }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cs, setCs] = useState(p.contract_start ?? "");
  const [ce, setCe] = useState(p.contract_end ?? "");
  const [msg, setMsg] = useState("");
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 2500); };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.ok) { flash(ok); router.refresh(); } else flash(r.error ?? "실패"); });

  const cur = thisYm();
  const hasCur = p.cycles.some((c) => c.ym === cur);

  return (
    <div className="card">
      <div className="hd" style={{ flexWrap: "wrap", gap: 8 }}>
        <b><Link href={`/brand/${p.brand_id}`} className="hover:underline">{p.brand_name}</Link> — {p.title}</b>
        <span className="chip grn">회차 {p.cycles.length}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--ink3)" }}>계약기간</span>
          <input className="f" type="date" value={cs} onChange={(e) => setCs(e.target.value)} style={{ fontSize: 12 }} />
          <span>~</span>
          <input className="f" type="date" value={ce} onChange={(e) => setCe(e.target.value)} style={{ fontSize: 12 }} />
          <button className="btn sm" disabled={pending} onClick={() => run(() => setRoutineContractAction(p.id, cs, ce), "계약기간 저장됨")}>저장</button>
          {!hasCur && <button className="btn sm pri" disabled={pending} onClick={() => run(() => addRoutineCycleAction(p.id, cur), `${cur} 회차 개설됨`)}>+ 이번 달({cur}) 회차</button>}
        </div>
      </div>
      <div className="bd">
        {/* 월별 회차 칸반 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {ROUTINE_STAGES.map((stg) => {
            const list = p.cycles.filter((c) => c.stage === stg.key).sort((a, b) => (a.ym < b.ym ? 1 : -1));
            return (
              <div key={stg.key} style={{ background: "#f8fafc", borderRadius: 8, padding: 6, minHeight: 60 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink2)", marginBottom: 6, textAlign: "center" }}>{stg.label} · {list.length}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {list.map((c) => <RoutineCycleCard key={c.id} c={c} pending={pending} run={run} />)}
                </div>
              </div>
            );
          })}
        </div>
        {p.cycles.length === 0 && <div className="note" style={{ marginTop: 8 }}>회차가 없습니다 — 「+ 이번 달 회차」로 시작하세요. 완료 처리 시 다음 달 회차가 자동 개설됩니다.</div>}
        {msg && <div className="note" style={{ marginTop: 8, color: "var(--ok)" }}>{msg}</div>}
      </div>
    </div>
  );
}

const STAGE_ORDER: RoutineCycle["stage"][] = ["plan", "running", "report", "done"];
function RoutineCycleCard({ c, pending, run }: { c: RoutineCycle; pending: boolean; run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(c.note ?? "");
  const [report, setReport] = useState(c.report_url ?? "");
  const idx = STAGE_ORDER.indexOf(c.stage);
  return (
    <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 7, padding: "6px 8px", fontSize: 11.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <b>{c.ym}</b>
        <button className="btn sm" style={{ marginLeft: "auto", padding: "0 5px" }} disabled={pending || idx <= 0} title="이전 단계"
          onClick={() => run(() => setRoutineCycleStageAction(c.id, STAGE_ORDER[idx - 1]), "단계 이동됨")}>◀</button>
        <button className="btn sm" style={{ padding: "0 5px" }} disabled={pending || idx >= STAGE_ORDER.length - 1} title="다음 단계(완료 시 다음 달 자동 개설)"
          onClick={() => run(() => setRoutineCycleStageAction(c.id, STAGE_ORDER[idx + 1]), idx + 1 === STAGE_ORDER.length - 1 ? "완료 — 다음 달 회차 개설됨" : "단계 이동됨")}>▶</button>
      </div>
      {c.note && !open && <div style={{ color: "var(--ink3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.note}</div>}
      {c.report_url && !open && <a href={c.report_url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)", fontSize: 10.5 }}>📎 리포트</a>}
      <button style={{ border: "none", background: "none", color: "var(--acc)", fontSize: 10.5, cursor: "pointer", padding: 0, marginTop: 2 }} onClick={() => setOpen((o) => !o)}>{open ? "접기" : "편집"}</button>
      {open && (
        <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
          <textarea className="f" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="회차 메모(시딩/라방 내역 등)" style={{ fontSize: 11 }} />
          <input className="f" value={report} onChange={(e) => setReport(e.target.value)} placeholder="리포트 링크" style={{ fontSize: 11 }} />
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn sm pri" disabled={pending} onClick={() => { run(() => updateRoutineCycleAction(c.id, note, report), "저장됨"); setOpen(false); }}>저장</button>
            <button className="btn sm" style={{ color: "var(--bad)" }} disabled={pending} onClick={() => { if (confirm(`${c.ym} 회차를 삭제할까요?`)) run(() => deleteRoutineCycleAction(c.id), "삭제됨"); }}>삭제</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 탭: 마케팅 제안서 (기획확정 7절) ──────────────────────────
// 작성(브랜드·제목·금액·기간·범위 메모) → proposals(kind='marketing') 저장.
// 발송은 초안함(email_drafts) 경유 — 여기서는 "발송 준비"까지, 승인·발송은 /drafts.
const PROP_ST: Record<string, { ko: string; cc: string }> = {
  draft: { ko: "작성", cc: "cc-ing" },
  sent: { ko: "발송", cc: "cc-warn" },
  accepted: { ko: "수락", cc: "cc-ok" },
  rejected: { ko: "거절", cc: "cc-no" },
};
const DRAFT_ST: Record<string, { ko: string; cc: string }> = {
  draft: { ko: "초안 대기(승인 전)", cc: "cc-warn" },
  approved: { ko: "승인(발송 대기)", cc: "cc-warn" },
  sent: { ko: "발송됨", cc: "cc-ok" },
  discarded: { ko: "초안 폐기", cc: "cc-no" },
};

function fmtTs(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "";
}

function Proposals({
  proposals,
  brands,
  projects,
}: {
  proposals: MktProposalRow[];
  brands: MktBrandOpt[];
  projects: MktRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [ps, setPs] = useState("");
  const [pe, setPe] = useState("");
  const [note, setNote] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [linkProject, setLinkProject] = useState(true);
  const [proposeDate, setProposeDate] = useState("");
  const [rfp, setRfp] = useState("");
  const [rfpFile, setRfpFile] = useState("");
  const [aiDir, setAiDir] = useState("");
  const [busyAi, setBusyAi] = useState(false);
  const [editRow, setEditRow] = useState<MktProposalRow | null>(null);
  const [regOpen, setRegOpen] = useState(false);
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regCat, setRegCat] = useState("");
  const [localBrands, setLocalBrands] = useState<MktBrandOpt[]>(brands);

  // 브랜드별 mkt_projects 연결 수 (연결 표시용)
  const projCount = new Map<string, number>();
  for (const p of projects) projCount.set(p.brand_id, (projCount.get(p.brand_id) ?? 0) + 1);

  function submit() {
    setErr("");
    setOk("");
    start(async () => {
      try {
        const r = await createMktProposalAction({
          brand_id: brandId,
          title,
          amount,
          period_start: ps,
          period_end: pe,
          note,
          file_url: fileUrl,
          propose_date: proposeDate,
          rfp_text: rfp,
          rfp_file_url: rfpFile,
          ai_direction: aiDir,
          link_project: linkProject,
        });
        if (r.ok) {
          setTitle(""); setAmount(""); setPs(""); setPe(""); setNote(""); setFileUrl("");
          setProposeDate(""); setRfp(""); setRfpFile(""); setAiDir("");
          setOk("제안서가 저장되었습니다 — 발송 준비 후 초안함에서 승인·발송하세요.");
          router.refresh();
        } else setErr(r.error ?? "저장 실패");
      } catch (e) {
        setErr(`저장 중 오류: ${(e as Error).message ?? "알 수 없는 오류"}`);
      }
    });
  }

  function pullRfp() {
    setErr(""); setOk("");
    start(async () => {
      const r = await pullRfpFromSurveyAction(brandId);
      if (r.ok && r.rfp) { setRfp(r.rfp); setOk("설문에서 RFP 를 불러왔습니다."); }
      else setErr(r.error ?? "RFP 불러오기 실패");
    });
  }
  async function genDir() {
    setErr(""); setOk(""); setBusyAi(true);
    const r = await generateDirectionDraftAction({ brand_id: brandId, amount, rfp });
    setBusyAi(false);
    if (r.ok && r.direction) { setAiDir(r.direction); setOk("AI 제안 방향을 생성했습니다 — 검토 후 저장하세요."); }
    else setErr(r.error ?? "AI 제안 방향 생성 실패");
  }

  function registerBrand() {
    setErr(""); setOk("");
    start(async () => {
      const r = await registerMktBrandAction({ brand_name: regName, email: regEmail || undefined, category: regCat || undefined });
      if (r.ok && r.brand_id) {
        setLocalBrands((prev) => [{ id: r.brand_id!, name: regName.trim(), contract_type: "marketing" }, ...prev]);
        setBrandId(r.brand_id);
        setRegOpen(false); setRegName(""); setRegEmail(""); setRegCat("");
        setOk("브랜드가 등록되었습니다 — 아래에서 제안서를 작성하세요.");
      } else setErr(r.error ?? "브랜드 등록 실패");
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setErr("");
    setOk("");
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          setOk(okMsg);
          router.refresh();
        } else setErr(r.error ?? "실패");
      } catch (e) {
        setErr(`오류: ${(e as Error).message ?? "알 수 없는 오류"}`);
      }
    });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 작성 폼 */}
      <div className="card">
        <div className="hd">
          <b>마케팅 제안서 작성</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>
            저장 → 발송 준비(초안함) → 담당 승인 후 발송
          </span>
        </div>
        <div className="bd" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, alignItems: "end" }}>
          <div style={{ gridColumn: "1 / -1", maxWidth: 360 }}>
            <label className="f">브랜드 <button type="button" onClick={() => setRegOpen((o) => !o)} style={{ marginLeft: 6, fontSize: 10.5, color: "var(--acc)", background: "none", border: 0, cursor: "pointer" }}>{regOpen ? "취소" : "+ 리드 없는 브랜드 등록"}</button></label>
            {regOpen ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input className="f" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="브랜드명 *" style={{ width: 140 }} />
                <input className="f" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="이메일(선택)" style={{ width: 150 }} />
                <input className="f" value={regCat} onChange={(e) => setRegCat(e.target.value)} placeholder="카테고리(선택)" style={{ width: 120 }} />
                <button className="btn sm pri" disabled={pending || !regName.trim()} onClick={registerBrand}>등록</button>
              </div>
            ) : (
              <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }}>
                {localBrands.length === 0 && <option value="">브랜드가 없습니다 — 우측 '+ 등록'</option>}
                {localBrands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.contract_type === "marketing" ? " · 마케팅 트랙" : ""}</option>
                ))}
              </select>
            )}
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="f">제목</label>
            <input className="f" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 8월 시딩+라이브 패키지 제안" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label className="f">금액(원)</label>
            <input className="f" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="예: 3000000" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label className="f">제안 예정일</label>
            <input className="f" type="date" value={proposeDate} onChange={(e) => setProposeDate(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label className="f">기간 시작</label>
            <input className="f" type="date" value={ps} onChange={(e) => setPs(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div>
            <label className="f">기간 종료</label>
            <input className="f" type="date" value={pe} onChange={(e) => setPe(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="f">범위 메모</label>
            <input className="f" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 시딩 30건 + 라이브 2회 + 소재 4종" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="f">제안서 파일 링크 (드라이브 PPT/PDF)</label>
            <input className="f" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://drive.google.com/…" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>

          {/* 사전 RFP — 설문에서 불러오기 / 직접 입력 / 파일 링크 */}
          <div style={{ gridColumn: "1 / -1", borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
            <label className="f" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              사전 RFP
              <button type="button" className="btn sm" disabled={pending || !brandId} onClick={pullRfp}>설문에서 불러오기</button>
              <span style={{ color: "var(--ink3)", fontSize: 10.5 }}>브랜드 설문 응답을 RFP 초안으로. 없으면 아래에 직접 입력/파일 링크</span>
            </label>
            <textarea className="f" value={rfp} onChange={(e) => setRfp(e.target.value)} rows={3} style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="예산·목표국·일정·니즈 등 RFP 내용" />
            <input className="f" value={rfpFile} onChange={(e) => setRfpFile(e.target.value)} placeholder="RFP 파일 링크(선택) — https://…" style={{ width: "100%", boxSizing: "border-box", marginTop: 6 }} />
          </div>

          {/* AI 제안 방향 — 예산·RFP·우리 서비스 기반 */}
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="f" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              AI 제안 방향
              <button type="button" className="btn sm pri" disabled={busyAi || pending || !brandId} onClick={genDir}>{busyAi ? "생성 중…" : "🤖 AI 제안방향 생성"}</button>
              <span style={{ color: "var(--ink3)", fontSize: 10.5 }}>예산 + RFP + 우리 서비스(설정) 기반. 검토·수정 후 저장</span>
            </label>
            <textarea className="f" value={aiDir} onChange={(e) => setAiDir(e.target.value)} rows={5} style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="AI 제안방향 생성 버튼을 누르면 채워집니다(직접 수정 가능)" />
          </div>

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink2)" }} title="파이프라인 개별 프로젝트 보드에 카드로도 등록·연결">
              <input type="checkbox" checked={linkProject} onChange={(e) => setLinkProject(e.target.checked)} />
              파이프라인 프로젝트로 등록
            </label>
            <button className="btn pri" style={{ marginLeft: "auto" }} disabled={pending || !brandId} onClick={submit}>
              {pending ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
        {(err || ok) && (
          <div className="bd" style={{ paddingTop: 0 }}>
            {err && <span className="chip red" style={{ fontSize: 11 }}>{err}</span>}
            {ok && <span className="chip grn" style={{ fontSize: 11 }}>{ok}</span>}
          </div>
        )}
      </div>

      {/* 목록 — 발송·기록 포함 */}
      <div className="card overflow-x-auto">
        <div className="hd">
          <b>제안서 목록 · 발송 기록</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>
            발송은 초안함(email_drafts) 승인 경유 · 발송 확인 시 sent 기록
          </span>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th>브랜드</th><th>제목</th><th>금액</th><th>기간</th><th>범위</th>
              <th>제안 일정·RFP·AI</th>
              <th>상태</th><th>발송 기록(초안함)</th><th>프로젝트 연결</th><th></th>
            </tr>
          </thead>
          <tbody>
            {proposals.length === 0 && (
              <tr><td colSpan={10} style={{ color: "var(--ink3)" }}>마케팅 제안서가 없습니다 — 위에서 작성하세요.</td></tr>
            )}
            {proposals.map((p) => {
              const st = PROP_ST[p.status] ?? { ko: p.status, cc: "cc-ing" };
              const ds = p.draft_status ? DRAFT_ST[p.draft_status] ?? { ko: p.draft_status, cc: "cc-ing" } : null;
              const n = projCount.get(p.brand_id) ?? 0;
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/brand/${p.brand_id}`} className="hover:underline"><b>{p.brand_name}</b></Link>
                  </td>
                  <td>{p.title || "—"}</td>
                  <td>{p.amount != null ? `${p.amount.toLocaleString("ko-KR")}원` : "—"}</td>
                  <td>{p.period_start || p.period_end ? `${p.period_start ?? "미정"} ~ ${p.period_end ?? "미정"}` : "—"}</td>
                  <td>{p.note || "—"}{p.url && <div className="sub"><a href={p.url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>📎 제안서 파일 ↗</a></div>}</td>
                  <td style={{ minWidth: 160 }}>
                    <div className="sub">제안 {p.propose_date ?? "—"} · 최종 {p.final_due_date ?? "—"}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                      {(p.rfp_text || p.rfp_file_url) && <span className="cellchip cc-ok" style={{ fontSize: 10 }}>RFP</span>}
                      {p.rfp_file_url && <a href={p.rfp_file_url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)", fontSize: 10.5 }}>📎RFP</a>}
                    </div>
                    {p.ai_direction ? (
                      <details style={{ marginTop: 3 }}>
                        <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--acc)" }}>🤖 AI 방향</summary>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: 10.5, lineHeight: 1.5, fontFamily: "inherit", color: "var(--ink2)", marginTop: 4, maxWidth: 260 }}>{p.ai_direction}</pre>
                        <button className="btn sm" disabled={pending} onClick={() => run(() => regenerateDirectionAction(p.id), "AI 제안방향을 재생성했습니다.")}>재생성</button>
                      </details>
                    ) : (
                      <button className="btn sm" style={{ marginTop: 3 }} disabled={pending} onClick={() => run(() => regenerateDirectionAction(p.id), "AI 제안방향을 생성했습니다.")}>🤖 AI방향 생성</button>
                    )}
                  </td>
                  <td>
                    <span className={`cellchip ${st.cc}`}>{st.ko}</span>
                    {p.sent_at && <div className="sub">발송 {fmtTs(p.sent_at)}</div>}
                  </td>
                  <td>
                    {ds ? (
                      <>
                        <span className={`cellchip ${ds.cc}`}>{ds.ko}</span>
                        {p.draft_sent_at && <div className="sub">{fmtTs(p.draft_sent_at)}</div>}
                      </>
                    ) : (
                      <span style={{ color: "var(--ink3)" }}>기록 없음</span>
                    )}
                  </td>
                  <td>
                    {p.project_id ? (
                      <span className={`cellchip ${ST[p.project_status ?? "draft"]?.cc ?? "cc-ing"}`} title="연결된 파이프라인 프로젝트">
                        연결됨 · {ST[p.project_status ?? "draft"]?.ko ?? p.project_status}
                      </span>
                    ) : (
                      <button
                        className="btn sm"
                        disabled={pending}
                        onClick={() => run(() => createMktProjectAction({ brand_id: p.brand_id, title: p.title || "마케팅 프로젝트", proposal_id: p.id }), "파이프라인 프로젝트로 등록·연결했습니다.")}
                        title="이 제안서를 파이프라인 보드에 프로젝트로 등록·연결"
                      >
                        프로젝트로 등록
                      </button>
                    )}
                    {n > 1 && <div className="sub" style={{ color: "var(--ink3)" }}>브랜드 프로젝트 {n}건</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {p.status === "draft" && (!p.draft_status || p.draft_status === "discarded") && (
                      <button
                        className="btn sm"
                        disabled={pending}
                        onClick={() => run(() => draftMktProposalEmailAction(p.id), "발송 초안 생성 — 초안함에서 승인·발송하세요.")}
                      >
                        발송 준비
                      </button>
                    )}
                    {p.status === "draft" && p.draft_status === "sent" && (
                      <button
                        className="btn sm pri"
                        disabled={pending}
                        onClick={() => run(() => setMktProposalStatusAction(p.id, "sent"), "발송 처리되었습니다.")}
                      >
                        발송 확인
                      </button>
                    )}
                    {p.status === "sent" && (
                      <>
                        <button
                          className="btn sm pri"
                          disabled={pending}
                          onClick={() => run(() => setMktProposalStatusAction(p.id, "accepted"), "수락 처리되었습니다.")}
                        >
                          수락
                        </button>{" "}
                        <button
                          className="btn sm dgr"
                          disabled={pending}
                          onClick={() => run(() => setMktProposalStatusAction(p.id, "rejected"), "거절 처리되었습니다.")}
                        >
                          거절
                        </button>
                      </>
                    )}
                    <div style={{ marginTop: 4 }}>
                      <button className="btn sm" disabled={pending} onClick={() => setEditRow(p)} title="제안 일정·금액·RFP·AI방향 편집">✏️ 편집</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "10px 16px" }} className="note">
          📌 발송은 초안함(담당 승인·수신동의 게이트) 경유 — 승인·발송 후 이 목록에서 「발송 확인」으로 기록 확정 ·
          열람·회신은 브랜드360 미팅·메일 탭의 연동 메일에서 확인
        </div>
      </div>

      {editRow && <ProposalEditModal p={editRow} brands={localBrands} onClose={() => setEditRow(null)} />}
    </div>
  );
}

// 마케팅 제안서 주요 항목 편집 모달 — 제안 예정일·금액·RFP·AI 제안방향.
export interface ProposalEditData {
  id: string; brand_id: string; brand_name: string; title: string;
  amount: number | null; propose_date?: string | null;
  period_start?: string | null; period_end?: string | null;
  rfp_text?: string | null; rfp_file_url?: string | null; ai_direction?: string | null;
}
function ProposalEditModal({ p, brands = [], onClose }: { p: ProposalEditData; brands?: MktBrandOpt[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [brandId, setBrandId] = useState(p.brand_id);
  const [proposeDate, setProposeDate] = useState(p.propose_date ?? "");
  const [ps, setPs] = useState(p.period_start ?? "");
  const [pe, setPe] = useState(p.period_end ?? "");
  const [amount, setAmount] = useState(p.amount != null ? String(p.amount) : "");
  const [rfp, setRfp] = useState(p.rfp_text ?? "");
  const [rfpFile, setRfpFile] = useState(p.rfp_file_url ?? "");
  const [aiDir, setAiDir] = useState(p.ai_direction ?? "");
  const [busyAi, setBusyAi] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  function pullRfp() {
    start(async () => {
      const r = await pullRfpFromSurveyAction(p.brand_id);
      if (r.ok && r.rfp) { setRfp(r.rfp); setMsg({ t: "설문에서 RFP 를 불러왔습니다.", ok: true }); }
      else setMsg({ t: r.error ?? "RFP 불러오기 실패", ok: false });
    });
  }
  async function genDir() {
    setBusyAi(true);
    const r = await generateDirectionDraftAction({ brand_id: p.brand_id, amount, rfp });
    setBusyAi(false);
    if (r.ok && r.direction) { setAiDir(r.direction); setMsg({ t: "AI 제안방향을 생성했습니다.", ok: true }); }
    else setMsg({ t: r.error ?? "생성 실패", ok: false });
  }
  function save() {
    start(async () => {
      const r = await updateMktProposalMetaAction({
        id: p.id, propose_date: proposeDate, period_start: ps, period_end: pe, amount,
        rfp_text: rfp, rfp_file_url: rfpFile, ai_direction: aiDir, brand_id: brandId,
      });
      if (r.ok) { setMsg({ t: "저장되었습니다.", ok: true }); router.refresh(); setTimeout(onClose, 500); }
      else setMsg({ t: r.error ?? "저장 실패", ok: false });
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 100, display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(600px, 96vw)", maxHeight: "92vh", overflow: "auto", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <b style={{ fontSize: 15 }}>제안서 항목 편집</b>
          <span style={{ color: "var(--ink3)", fontSize: 12 }}>{p.title}</span>
          <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onClose}>닫기 ✕</button>
        </div>

        {/* 브랜드 연결(맵핑) 수정 — 다른 브랜드로 재연결 시 연결된 파이프라인 프로젝트도 함께 이동. */}
        <div style={{ marginBottom: 10 }}>
          <label className="f">연결 브랜드</label>
          {brands.length > 0 ? (
            <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }}>
              {brands.some((b) => b.id === p.brand_id) ? null : <option value={p.brand_id}>{p.brand_name}(현재)</option>}
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : (
            <span className="chip" style={{ fontSize: 11 }}>{p.brand_name}</span>
          )}
          {brandId !== p.brand_id && <div className="note" style={{ marginTop: 4, fontSize: 11, color: "var(--warn, #b45309)" }}>⚠ 저장 시 「{p.brand_name}」 → 선택 브랜드로 제안서·연결 프로젝트가 함께 이동합니다.</div>}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div><label className="f">제안 예정일</label><input className="f" type="date" value={proposeDate} onChange={(e) => setProposeDate(e.target.value)} /></div>
          <div><label className="f">기간 시작</label><input className="f" type="date" value={ps} onChange={(e) => setPs(e.target.value)} /></div>
          <div><label className="f">기간 종료</label><input className="f" type="date" value={pe} onChange={(e) => setPe(e.target.value)} /></div>
          <div><label className="f">금액(원)</label><input className="f" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 150 }} /></div>
        </div>

        <label className="f" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          사전 RFP <button type="button" className="btn sm" disabled={pending} onClick={pullRfp}>설문에서 불러오기</button>
        </label>
        <textarea className="f" value={rfp} onChange={(e) => setRfp(e.target.value)} rows={3} style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="예산·목표국·일정·니즈 등" />
        <input className="f" value={rfpFile} onChange={(e) => setRfpFile(e.target.value)} placeholder="RFP 파일 링크(선택)" style={{ width: "100%", boxSizing: "border-box", marginTop: 6 }} />

        <label className="f" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          AI 제안 방향 <button type="button" className="btn sm pri" disabled={busyAi || pending} onClick={genDir}>{busyAi ? "생성 중…" : "🤖 재생성"}</button>
        </label>
        <textarea className="f" value={aiDir} onChange={(e) => setAiDir(e.target.value)} rows={6} style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="AI 제안방향(직접 수정 가능)" />

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <button className="btn pri" disabled={pending} onClick={save}>{pending ? "저장 중…" : "저장"}</button>
          {msg && <span className="chip" style={{ fontSize: 11, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.t}</span>}
        </div>
      </div>
    </div>
  );
}

// ── 탭 3: 브랜드사별 매핑 ─────────────────────────────────────
function BrandMap({ rows }: { rows: MktRow[] }) {
  const byBrand = new Map<string, MktRow[]>();
  for (const r of rows) {
    const arr = byBrand.get(r.brand_id) ?? [];
    arr.push(r);
    byBrand.set(r.brand_id, arr);
  }
  const brands = [...byBrand.entries()].map(([id, list]) => ({
    id,
    name: list[0].brand_name,
    list,
  }));
  const [sel, setSel] = useState<string | null>(brands[0]?.id ?? null);
  const cur = brands.find((b) => b.id === sel) ?? brands[0];

  if (brands.length === 0) {
    return <div className="note">마케팅 파이프라인이 연결된 브랜드사가 없습니다.</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "290px 1fr", gap: 14 }}>
      <div className="card">
        <div className="hd">
          <b>브랜드사</b>
          <span style={{ color: "var(--ink3)", fontSize: "11px" }}>마케팅 파이프라인 보유</span>
        </div>
        <div style={{ padding: "4px 0 8px" }}>
          <div className="ml">
            {brands.map((b) => (
              <div
                key={b.id}
                className={`it ${b.id === sel ? "on" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSel(b.id)}
              >
                <div className="fr">
                  {b.name} <span>{b.list.length}건</span>
                </div>
                <div className="pv">
                  {b.list.some((r) => r.kind === "routine") && (
                    <span className="cellchip cc-ing" style={{ fontSize: "9.5px" }}>
                      운영대행
                    </span>
                  )}{" "}
                  {b.list.some((r) => r.proposal_status === "won") && (
                    <span className="cellchip cc-ok" style={{ fontSize: "9.5px" }}>
                      수주
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        {cur && (
          <div className="card">
            <div className="hd">
              <b>
                <Link href={`/brand/${cur.id}`} className="hover:underline">
                  {cur.name}
                </Link>{" "}
                — 프로젝트 {cur.list.length}건
              </b>
              <div className="rt">
                <Link href={`/brand/${cur.id}`} className="btn sm">
                  브랜드 카드
                </Link>
              </div>
            </div>
            <table className="t">
              <tbody>
                <tr>
                  <th>구분</th>
                  <th>프로젝트</th>
                  <th>메모</th>
                  <th>제안 현황</th>
                </tr>
                {cur.list.map((r) => (
                  <tr key={r.id} style={r.kind === "routine" ? { background: "#f0fdf4" } : undefined}>
                    <td>
                      <span className={`cellchip ${r.kind === "routine" ? "cc-ok" : "cc-ing"}`}>
                        {r.kind === "routine" ? "루틴" : "개별"}
                      </span>
                    </td>
                    <td>
                      <b>{r.title}</b>
                    </td>
                    <td>{r.note || "—"}</td>
                    <td>
                      <span className={`cellchip ${ST[r.proposal_status]?.cc ?? "cc-no"}`}>
                        {ST[r.proposal_status]?.ko ?? r.proposal_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
