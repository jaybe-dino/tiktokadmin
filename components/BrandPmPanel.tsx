"use client";
// 브랜드360 「PM 에이전트」 탭 — 현황·대화 추적·KPI·업무·분석.
//   표기 원칙:
//     · "모든 채널 100% 추적"이라고 적지 않는다. 채널별로 조회/수집/최근성을 따로 보여준다.
//     · 값 없음(—)과 0 을 구분한다.
//     · AI 제안·규칙 제안·사람이 확정한 업무를 배지로 구분한다.
//     · 대화 본문은 외부가 쓴 자료다 — 그대로 보여주기만 하고 지시로 실행하지 않는다.
import { useEffect, useState, useTransition } from "react";
import {
  pmOverviewAction, pmCommsAction, pmTaskHistoryAction,
  pmSetEnabledAction, pmSetOwnerAction, pmSetNoteAction,
  pmCreateKpiAction, pmUpdateKpiAction, pmArchiveKpiAction,
  pmCreateTaskAction, pmUpdateTaskAction, pmSetTaskStatusAction, pmConfirmTaskAction,
  pmAddCommAction, pmDeleteCommAction, pmRunAction, pmQaFixtureAction,
} from "@/app/(dash)/brand/[id]/pm-actions";

type Ov = NonNullable<Awaited<ReturnType<typeof pmOverviewAction>>["data"]>;
type Tl = NonNullable<Awaited<ReturnType<typeof pmCommsAction>>["data"]>;
type Task = Ov["openTasks"][number];
type Kpi = Ov["kpis"][number];

const ts = (v: string | null) => (v ? String(v).slice(0, 16).replace("T", " ") : "—");
const dash = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${v}${unit}`);

const RISK_LABEL: Record<string, string> = {
  unknown: "목표 없음", no_measure: "미측정", on_track: "정상", at_risk: "미달 위험", overdue: "기한 초과",
};
const RISK_COLOR: Record<string, string> = {
  unknown: "#6b7280", no_measure: "#c25400", on_track: "#0b7a52", at_risk: "#c25400", overdue: "#c92a2a",
};
const KIND_LABEL: Record<string, string> = { issue: "문제", todo: "할일", question: "확인" };
const ORIGIN_LABEL: Record<string, string> = { human: "사람 등록", rules: "규칙 제안", ai: "AI 제안" };
const ST_LABEL: Record<string, string> = { open: "열림", doing: "진행", done: "완료", reopened: "재열림", dismissed: "보류" };
const QUERY_LABEL: Record<string, string> = { ok: "조회 가능", error: "조회 실패", absent: "표 없음" };
const INGEST_LABEL: Record<string, string> = {
  configured: "자동 수집 설정됨", off: "자동 수집 꺼짐", unknown: "수집 상태 미확인",
  internal: "내부 기록(자동 수집 무관)", none: "자동 수집 없음",
};

export default function BrandPmPanel({ brandId, admins }: { brandId: string; admins: { id: string; name: string }[] }) {
  const [ov, setOv] = useState<Ov | null>(null);
  const [ovErr, setOvErr] = useState("");
  const [tl, setTl] = useState<Tl | null>(null);
  const [tlErr, setTlErr] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hist, setHist] = useState<Record<string, { field: string; oldValue: string; newValue: string; actor: string; at: string }[]>>({});
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const flash = (m: string) => { setMsg(m); };

  const loadOv = () => start(async () => {
    setOvErr("");
    const r = await pmOverviewAction(brandId);
    if (r.ok) setOv(r.data ?? null); else { setOv(null); setOvErr(r.error ?? "불러오지 못했습니다."); }
  });
  const loadTl = (p = page, query = q) => start(async () => {
    setTlErr("");
    const r = await pmCommsAction(brandId, { q: query, page: p, pageSize: 25 });
    if (r.ok) { setTl(r.data ?? null); setPage(r.data?.page ?? 1); } else { setTl(null); setTlErr(r.error ?? "불러오지 못했습니다."); }
  });
  useEffect(() => { loadOv(); loadTl(1, ""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; note?: string }>, after: "ov" | "tl" | "both" = "ov") =>
    start(async () => {
      const r = await fn();
      flash(r.ok ? (r.note ?? "완료") : (r.error ?? "실패"));
      if (r.ok) { if (after !== "tl") loadOv(); if (after !== "ov") loadTl(); }
    });

  // ── 렌더 ───────────────────────────────────────────────────
  if (ovErr) {
    return (
      <div className="card"><div className="bd">
        <div data-testid="pm-error" style={{ color: "#c92a2a", fontSize: 13, lineHeight: 1.8 }}>
          PM 에이전트를 열 수 없습니다 — {ovErr}
        </div>
        <button className="btn btn-sm" style={{ marginTop: 8 }} disabled={pending} onClick={loadOv}>다시 시도</button>
      </div></div>
    );
  }
  if (!ov) return <div className="card"><div className="bd" style={{ fontSize: 13, color: "var(--ink3)" }}>불러오는 중…</div></div>;

  const cfg = ov.config;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ① PM 현황 */}
      <div className="card">
        <div className="hd">
          <b>🧭 PM 에이전트</b>
          <span className={`chip ${cfg.enabled ? "chip-grn" : "chip-amb"}`} style={{ marginLeft: 8 }}>
            {cfg.enabled ? "자동 운영 ON" : "자동 운영 OFF"}
          </span>
          {ov.isTest && <span className="chip" style={{ marginLeft: 6 }}>테스트 브랜드</span>}
          <button className="btn btn-sm" style={{ marginLeft: "auto" }} disabled={pending} onClick={() => { loadOv(); loadTl(); }}>새로고침</button>
        </div>
        <div className="bd" style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button data-testid="pm-toggle" className="btn btn-sm" disabled={pending}
              onClick={() => act(() => pmSetEnabledAction(brandId, !cfg.enabled))}>
              {cfg.enabled ? "자동 운영 중지" : "자동 운영 시작"}
            </button>
            <label>PM 담당자{" "}
              <select className="f" defaultValue={cfg.ownerAdminId ?? ""} disabled={pending || !ov.canAssignPm}
                onChange={(e) => act(() => pmSetOwnerAction(brandId, e.target.value))}>
                <option value="">— 미지정 —</option>
                {admins.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
              </select>
            </label>
            {!ov.canAssignPm && <span style={{ color: "var(--ink3)" }}>담당자 지정은 파트장·대표 또는 브랜드 배정 담당자만</span>}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "var(--ink2)" }}>
            <span>마지막 분석 <b>{ts(cfg.lastRunAt)}</b></span>
            <span>방식 <b>{cfg.lastRunMode === "ai" ? "AI + 규칙" : cfg.lastRunMode === "rules" ? "규칙만" : "—"}</b></span>
            <span style={{ color: cfg.lastStatus === "error" ? "#c92a2a" : undefined }}>
              결과 <b>{cfg.lastStatus === "ok" ? "정상" : cfg.lastStatus === "error" ? "오류" : "—"}</b>
            </span>
          </div>
          {cfg.lastError && <div style={{ color: "#c92a2a" }}>오류: {cfg.lastError}</div>}
          {cfg.lastSummary && <div style={{ color: "var(--ink2)" }}>{cfg.lastSummary}</div>}
          <div data-testid="pm-next-action">
            <b>다음 액션</b> — {cfg.nextAction || <span style={{ color: "var(--ink3)" }}>없음(제안·업무가 비어 있습니다)</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button data-testid="pm-run-ai" className="btn btn-sm btn-primary" disabled={pending}
              onClick={() => act(async () => {
                const r = await pmRunAction(brandId, true);
                return { ok: r.ok, error: r.error, note: [r.note, r.aiNote].filter(Boolean).join(" · ") };
              })}>분석 실행(AI + 규칙)</button>
            <button data-testid="pm-run-rules" className="btn btn-sm" disabled={pending}
              onClick={() => act(async () => {
                const r = await pmRunAction(brandId, false);
                return { ok: r.ok, error: r.error, note: [r.note, r.aiNote].filter(Boolean).join(" · ") };
              })}>규칙 점검만</button>
            <span style={{ color: "var(--ink3)" }}>AI 키가 없으면 규칙 점검만 돌고, 결과에 그렇게 표시됩니다(외부 발송 없음).</span>
          </div>
          <textarea className="f" rows={2} defaultValue={cfg.note} placeholder="PM 메모"
            onBlur={(e) => { if (e.target.value !== cfg.note) act(() => pmSetNoteAction(brandId, e.target.value)); }} />
        </div>
      </div>

      {/* ② 대화 타임라인 */}
      <div className="card">
        <div className="hd"><b>💬 대화 추적</b>
          {tl && tl.partial && <span className="chip" style={{ marginLeft: 8, background: "#fff5f5", color: "#c92a2a" }}>일부 확인 실패</span>}
          {tl && tl.ingestUnknown && <span className="chip chip-amb" style={{ marginLeft: 6 }}>수집 상태 미확인</span>}
        </div>
        <div className="bd" style={{ display: "grid", gap: 10, fontSize: 12.5 }}>
          {tlErr && <div style={{ color: "#c92a2a" }}>대화를 불러오지 못했습니다 — {tlErr}</div>}
          {tl && (
            <>
              <div data-testid="pm-channels" style={{ overflowX: "auto" }}>
                <table className="t" style={{ fontSize: 11.5, width: "100%" }}>
                  <thead><tr><th>채널</th><th>DB 조회</th><th>자동 수집</th><th>건수</th><th>가장 최근</th></tr></thead>
                  <tbody>
                    {tl.channels.map((c) => (
                      <tr key={c.channel}>
                        <td><b>{c.label}</b></td>
                        <td style={{ color: c.query === "error" ? "#c92a2a" : c.query === "ok" ? "#0b7a52" : "var(--ink3)" }}>
                          {QUERY_LABEL[c.query]}{c.queryNote ? ` · ${c.queryNote}` : ""}
                        </td>
                        <td style={{ color: c.ingest === "configured" ? "#0b7a52" : c.ingest === "unknown" ? "#c25400" : "var(--ink3)" }}>
                          {INGEST_LABEL[c.ingest]}{c.ingestNote ? ` · ${c.ingestNote}` : ""}
                        </td>
                        <td>{c.count == null ? "—" : c.count}</td>
                        <td>{ts(c.latestAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="note" style={{ fontSize: 11.5 }}>
                {tl.rangeNote}<br />
                이 목록은 <b>연결·조회 가능한 채널만</b> 담습니다. 모든 채널을 100% 추적한다는 뜻이 아닙니다.
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input className="f" value={q} placeholder="본문·제목·작성자 검색" style={{ width: 240 }}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") loadTl(1, q); }} />
                <button className="btn btn-sm" disabled={pending} onClick={() => loadTl(1, q)}>검색</button>
                {q && <button className="btn btn-sm" disabled={pending} onClick={() => { setQ(""); loadTl(1, ""); }}>초기화</button>}
                <span style={{ marginLeft: "auto", color: "var(--ink3)" }}>
                  총 {tl.total}건 · {tl.page}/{tl.pageCount}페이지
                </span>
                <button className="btn btn-sm" disabled={pending || tl.page <= 1} onClick={() => loadTl(tl.page - 1, q)}>이전</button>
                <button className="btn btn-sm" disabled={pending || tl.page >= tl.pageCount} onClick={() => loadTl(tl.page + 1, q)}>다음</button>
              </div>

              <div data-testid="pm-comms" style={{ display: "grid", gap: 6 }}>
                {tl.items.length === 0 && <div style={{ color: "var(--ink3)" }}>조회 조건에 맞는 대화가 없습니다.</div>}
                {tl.items.map((it) => (
                  <div key={it.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="chip">{it.channelLabel}</span>
                      <b>{it.title}</b>
                      <span style={{ color: "var(--ink3)" }}>{ts(it.occurredAt)}</span>
                      {it.author && <span style={{ color: "var(--ink3)" }}>· {it.author}</span>}
                      {it.sourceUrl
                        ? <a href={it.sourceUrl} target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}>원문 ↗</a>
                        : <span style={{ marginLeft: "auto", color: "var(--ink3)" }}>원문 링크 없음</span>}
                    </div>
                    <div style={{ marginTop: 4, color: "var(--ink2)", whiteSpace: "pre-wrap" }}>
                      {open[it.id] ? it.bodyFull : it.preview}
                    </div>
                    <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ color: "var(--ink3)", fontSize: 11 }}>출처: {it.sourceLabel}</span>
                      {(it.hasMore || open[it.id]) && (
                        <button className="btn btn-sm" onClick={() => setOpen((s) => ({ ...s, [it.id]: !s[it.id] }))}>
                          {open[it.id] ? "접기" : "본문 전체 보기"}
                        </button>
                      )}
                      <button className="btn btn-sm" disabled={pending}
                        onClick={() => act(() => pmCreateTaskAction(brandId, {
                          kind: "todo", title: `후속: ${it.title}`.slice(0, 200), priority: 2,
                          evidenceKind: "comm", evidenceId: it.id, evidenceUrl: it.sourceUrl ?? "",
                          evidenceLabel: `${it.channelLabel} · ${ts(it.occurredAt)}`,
                        }))}>이 대화로 할일 만들기</button>
                    </div>
                  </div>
                ))}
              </div>

              <ManualCommForm brandId={brandId} pending={pending} onDone={(m) => { flash(m); loadTl(1, q); }} />
            </>
          )}
        </div>
      </div>

      {/* ③ KPI */}
      <div className="card">
        <div className="hd"><b>🎯 KPI</b><span className="chip" style={{ marginLeft: 8 }}>{ov.kpis.length}개</span></div>
        <div className="bd" style={{ display: "grid", gap: 10, fontSize: 12.5 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="t" data-testid="pm-kpis" style={{ fontSize: 11.5, width: "100%" }}>
              <thead><tr><th>지표</th><th>목표</th><th>현재</th><th>측정일</th><th>달성률</th><th>기한</th><th>담당</th><th>상태</th><th /></tr></thead>
              <tbody>
                {ov.kpis.length === 0 && <tr><td colSpan={9} style={{ color: "var(--ink3)" }}>등록된 KPI 가 없습니다.</td></tr>}
                {ov.kpis.map((k) => <KpiRow key={k.id} brandId={brandId} k={k} admins={admins} pending={pending} onDone={(m) => { flash(m); loadOv(); }} />)}
              </tbody>
            </table>
          </div>
          <KpiForm brandId={brandId} admins={admins} pending={pending} onDone={(m) => { flash(m); loadOv(); }} />
          <div data-testid="pm-kpi-refs" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <b>참고 목표(계약·제안)</b>
            <div style={{ color: "var(--ink3)", fontSize: 11.5, marginTop: 2 }}>
              계약·제안에 적힌 값입니다. <b>합의 KPI 로 자동 확정하지 않습니다</b> — 확인 후 위에서 직접 등록해 주세요.
            </div>
            {ov.refs.error && <div style={{ color: "#c92a2a", marginTop: 4 }}>{ov.refs.error}</div>}
            {ov.refs.refs.length === 0 && !ov.refs.error && <div style={{ color: "var(--ink3)", marginTop: 4 }}>참고할 계약·제안 값이 없습니다.</div>}
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {ov.refs.refs.map((r, i) => (
                <li key={i}>{r.label}: <b>{r.value}</b> <span style={{ color: "var(--ink3)" }}>— {r.sourceLabel}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ④ 문제·할일 */}
      <div className="card">
        <div className="hd"><b>🗂 문제 · 할일</b>
          <span className="chip" style={{ marginLeft: 8 }}>열림 {ov.openTasks.length}</span>
          {ov.openTasks.some((t) => t.overdue) && <span className="chip" style={{ marginLeft: 6, background: "#fff5f5", color: "#c92a2a" }}>지연 {ov.openTasks.filter((t) => t.overdue).length}</span>}
          {ov.openTasks.some((t) => t.unassigned) && <span className="chip chip-amb" style={{ marginLeft: 6 }}>미배정 {ov.openTasks.filter((t) => t.unassigned).length}</span>}
        </div>
        <div className="bd" style={{ display: "grid", gap: 10, fontSize: 12.5 }}>
          <TaskForm brandId={brandId} admins={admins} pending={pending} onDone={(m) => { flash(m); loadOv(); }} />
          <div data-testid="pm-tasks" style={{ display: "grid", gap: 6 }}>
            {ov.openTasks.length === 0 && <div style={{ color: "var(--ink3)" }}>열린 문제·할일이 없습니다.</div>}
            {ov.openTasks.map((t) => (
              <TaskRow key={t.id} brandId={brandId} t={t} admins={admins} pending={pending}
                history={hist[t.id]}
                onHistory={() => start(async () => {
                  const r = await pmTaskHistoryAction(brandId, t.id);
                  if (r.ok) setHist((s) => ({ ...s, [t.id]: r.events ?? [] })); else flash(r.error ?? "이력 조회 실패");
                })}
                onDone={(m) => { flash(m); loadOv(); }} />
            ))}
          </div>
          {ov.doneTasks.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer" }}>완료·보류 {ov.doneTasks.length}건</summary>
              <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                {ov.doneTasks.map((t) => (
                  <div key={t.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", opacity: 0.75 }}>
                    <span className="chip">{KIND_LABEL[t.kind]}</span> <b>{t.title}</b>{" "}
                    <span style={{ color: "var(--ink3)" }}>{ST_LABEL[t.status]} · {ts(t.updatedAt)}</span>
                    <button className="btn btn-sm" style={{ marginLeft: 8 }} disabled={pending}
                      onClick={() => act(() => pmSetTaskStatusAction(brandId, t.id, "reopened"))}>다시 열기</button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* ⑤ 실행 이력 */}
      <div className="card">
        <div className="hd"><b>🧾 분석 실행 이력</b></div>
        <div className="bd" style={{ fontSize: 11.5 }}>
          {ov.runs.length === 0 && <div style={{ color: "var(--ink3)" }}>실행 기록이 없습니다.</div>}
          {ov.runs.length > 0 && (
            <table className="t" style={{ width: "100%" }}>
              <thead><tr><th>시작</th><th>방식</th><th>결과</th><th>내용</th><th>호출</th></tr></thead>
              <tbody>
                {ov.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{ts(r.startedAt)}</td>
                    <td>{r.mode === "ai" ? "AI + 규칙" : "규칙만"}</td>
                    <td style={{ color: r.status === "error" ? "#c92a2a" : r.status === "ok" ? "#0b7a52" : undefined }}>
                      {r.status === "ok" ? "정상" : r.status === "error" ? "오류" : "진행 중"}
                    </td>
                    <td style={{ color: "var(--ink3)" }}>{r.error || r.summary || "—"}</td>
                    <td>{r.triggeredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <QaFixture pending={pending} onDone={flash} />
        </div>
      </div>

      {msg && <div data-testid="pm-msg" style={{ fontSize: 12.5, color: "var(--ink2)" }}>{msg}</div>}
    </div>
  );
}

// ── 하위 폼·행 ────────────────────────────────────────────────
function KpiRow({ brandId, k, admins, pending, onDone }: {
  brandId: string; k: Kpi; admins: { id: string; name: string }[]; pending: boolean; onDone: (m: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({
    name: k.name, unit: k.unit,
    target: k.target == null ? "" : String(k.target),
    current: k.current == null ? "" : String(k.current),
    measuredAt: k.measuredAt ?? "", direction: k.direction,
    periodStart: k.periodStart ?? "", periodEnd: k.periodEnd ?? "",
    owner: k.owner ?? "", evidence: k.evidence,
  });
  const save = async () => {
    const r = await pmUpdateKpiAction(brandId, k.id, {
      name: f.name, unit: f.unit,
      target: f.target === "" ? null : Number(f.target),
      current: f.current === "" ? null : Number(f.current),
      measuredAt: f.measuredAt || null, direction: f.direction as "up" | "down",
      periodStart: f.periodStart || null, periodEnd: f.periodEnd || null,
      owner: f.owner || null, evidence: f.evidence,
    });
    onDone(r.ok ? (r.note ?? "저장됨") : (r.error ?? "실패"));
    if (r.ok) setEdit(false);
  };
  if (edit) {
    return (
      <tr>
        <td colSpan={9}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <input className="f" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="지표명" style={{ width: 160 }} />
              <input className="f" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="단위" style={{ width: 70 }} />
              <input className="f" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="목표(비우면 없음)" style={{ width: 130 }} />
              <input className="f" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} placeholder="현재(비우면 없음)" style={{ width: 130 }} />
              <input className="f" type="date" value={f.measuredAt} onChange={(e) => setF({ ...f, measuredAt: e.target.value })} style={{ width: 140 }} />
              <select className="f" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as "up" | "down" })}>
                <option value="up">높을수록 좋음</option><option value="down">낮을수록 좋음(역방향)</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <input className="f" type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} style={{ width: 140 }} />
              <input className="f" type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} style={{ width: 140 }} />
              <select className="f" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
                <option value="">담당 미지정</option>
                {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input className="f" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="근거(합의 출처)" style={{ flex: 1, minWidth: 180 }} />
              <button className="btn btn-sm btn-primary" disabled={pending} onClick={save}>저장</button>
              <button className="btn btn-sm" disabled={pending} onClick={() => setEdit(false)}>취소</button>
            </div>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td><b>{k.name}</b>{k.evidence && <div style={{ color: "var(--ink3)", fontSize: 11 }}>근거: {k.evidence}</div>}</td>
      <td>{dash(k.target, k.unit)}</td>
      <td>{dash(k.current, k.unit)}</td>
      <td>{k.measuredAt ?? "—"}</td>
      <td>{k.progress == null ? "—" : `${k.progress.toFixed(0)}%`}</td>
      <td>{k.periodEnd ?? "—"}{k.daysLeft != null && <span style={{ color: k.daysLeft < 0 ? "#c92a2a" : "var(--ink3)" }}> ({k.daysLeft < 0 ? `${-k.daysLeft}일 지남` : `${k.daysLeft}일 남음`})</span>}</td>
      <td>{k.owner ?? "—"}</td>
      <td style={{ color: RISK_COLOR[k.risk] }}>{RISK_LABEL[k.risk]}{k.direction === "down" ? " · 역방향" : ""}</td>
      <td>
        <button className="btn btn-sm" disabled={pending} onClick={() => setEdit(true)}>수정</button>{" "}
        <button className="btn btn-sm" disabled={pending}
          onClick={async () => { const r = await pmArchiveKpiAction(brandId, k.id); onDone(r.ok ? (r.note ?? "보관됨") : (r.error ?? "실패")); }}>보관</button>
      </td>
    </tr>
  );
}

function KpiForm({ brandId, admins, pending, onDone }: { brandId: string; admins: { id: string; name: string }[]; pending: boolean; onDone: (m: string) => void }) {
  const [o, setO] = useState(false);
  const [f, setF] = useState({ name: "", unit: "", target: "", current: "", measuredAt: "", direction: "up", periodStart: "", periodEnd: "", owner: "", evidence: "" });
  if (!o) return <button className="btn btn-sm" onClick={() => setO(true)}>＋ KPI 추가</button>;
  return (
    <div style={{ display: "grid", gap: 4, border: "1px solid var(--line)", borderRadius: 10, padding: 8 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <input className="f" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="지표명 (필수)" style={{ width: 160 }} />
        <input className="f" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="단위" style={{ width: 70 }} />
        <input className="f" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="목표(비우면 없음)" style={{ width: 130 }} />
        <input className="f" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} placeholder="현재(비우면 없음)" style={{ width: 130 }} />
        <input className="f" type="date" value={f.measuredAt} onChange={(e) => setF({ ...f, measuredAt: e.target.value })} style={{ width: 140 }} />
        <select className="f" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
          <option value="up">높을수록 좋음</option><option value="down">낮을수록 좋음(역방향)</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <input className="f" type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} style={{ width: 140 }} />
        <input className="f" type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} style={{ width: 140 }} />
        <select className="f" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
          <option value="">담당 미지정</option>
          {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input className="f" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="근거(합의 출처 — 계약·회의 등)" style={{ flex: 1, minWidth: 180 }} />
        <button className="btn btn-sm btn-primary" disabled={pending}
          onClick={async () => {
            const r = await pmCreateKpiAction(brandId, {
              name: f.name, unit: f.unit,
              target: f.target === "" ? null : Number(f.target),
              current: f.current === "" ? null : Number(f.current),
              measuredAt: f.measuredAt || null, direction: f.direction as "up" | "down",
              periodStart: f.periodStart || null, periodEnd: f.periodEnd || null,
              owner: f.owner || null, evidence: f.evidence,
            });
            onDone(r.ok ? (r.note ?? "추가됨") : (r.error ?? "실패"));
            if (r.ok) { setO(false); setF({ name: "", unit: "", target: "", current: "", measuredAt: "", direction: "up", periodStart: "", periodEnd: "", owner: "", evidence: "" }); }
          }}>추가</button>
        <button className="btn btn-sm" onClick={() => setO(false)}>취소</button>
      </div>
      <div style={{ color: "var(--ink3)", fontSize: 11 }}>목표·현재값을 비우면 <b>값 없음(—)</b> 으로 저장됩니다. 0 을 넣으면 실제 0 입니다.</div>
    </div>
  );
}

function TaskRow({ brandId, t, admins, pending, history, onHistory, onDone }: {
  brandId: string; t: Task; admins: { id: string; name: string }[]; pending: boolean;
  history?: { field: string; oldValue: string; newValue: string; actor: string; at: string }[];
  onHistory: () => void; onDone: (m: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({
    kind: t.kind, title: t.title, detail: t.detail, priority: String(t.priority),
    owner: t.owner ?? "", dueDate: t.dueDate ?? "",
  });
  const isSuggestion = t.origin !== "human" && !t.confirmedBy;
  return (
    <div style={{
      border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px",
      background: t.overdue ? "#fff5f5" : isSuggestion ? "#f8fafc" : undefined,
    }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="chip">{KIND_LABEL[t.kind]}</span>
        <span className="chip" style={{ background: t.priority === 1 ? "#fee2e2" : undefined, color: t.priority === 1 ? "#b91c1c" : undefined }}>
          P{t.priority}
        </span>
        <span className="chip" style={{ background: t.origin === "ai" ? "#ede9fe" : t.origin === "rules" ? "#e0f2fe" : "#dcfce7" }}>
          {ORIGIN_LABEL[t.origin]}{t.confirmedBy ? " · 사람 확정" : isSuggestion ? " · 미확정" : ""}
        </span>
        <b>{t.title}</b>
        {t.overdue && <span style={{ color: "#c92a2a" }}>마감 {t.dueDate} 지남</span>}
        {!t.overdue && t.dueDate && <span style={{ color: "var(--ink3)" }}>마감 {t.dueDate}</span>}
        <span style={{ color: t.unassigned ? "#c25400" : "var(--ink3)" }}>{t.owner ?? "담당 미배정"}</span>
        <span style={{ marginLeft: "auto", color: "var(--ink3)" }}>{ST_LABEL[t.status]}</span>
      </div>
      {t.detail && <div style={{ marginTop: 4, color: "var(--ink2)", whiteSpace: "pre-wrap" }}>{t.detail}</div>}
      {t.evidenceLabel && (
        <div style={{ marginTop: 3, fontSize: 11, color: "var(--ink3)" }}>
          근거: {t.evidenceLabel}{t.evidenceUrl && <> · <a href={t.evidenceUrl} target="_blank" rel="noreferrer">원문 ↗</a></>}
        </div>
      )}
      <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
        {isSuggestion && <button className="btn btn-sm btn-primary" disabled={pending}
          onClick={async () => { const r = await pmConfirmTaskAction(brandId, t.id); onDone(r.ok ? (r.note ?? "확정됨") : (r.error ?? "실패")); }}>사람이 확정</button>}
        <button className="btn btn-sm" disabled={pending} onClick={() => setEdit((v) => !v)}>{edit ? "닫기" : "수정"}</button>
        {t.status !== "doing" && <button className="btn btn-sm" disabled={pending}
          onClick={async () => { const r = await pmSetTaskStatusAction(brandId, t.id, "doing"); onDone(r.ok ? (r.note ?? "진행") : (r.error ?? "실패")); }}>진행</button>}
        <button className="btn btn-sm" disabled={pending}
          onClick={async () => { const r = await pmSetTaskStatusAction(brandId, t.id, "done"); onDone(r.ok ? (r.note ?? "완료") : (r.error ?? "실패")); }}>완료</button>
        <button className="btn btn-sm" disabled={pending}
          onClick={async () => { const r = await pmSetTaskStatusAction(brandId, t.id, "dismissed"); onDone(r.ok ? (r.note ?? "보류") : (r.error ?? "실패")); }}>보류</button>
        <button className="btn btn-sm" disabled={pending} onClick={onHistory}>변경 이력</button>
      </div>
      {edit && (
        <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
          <select className="f" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Task["kind"] })}>
            <option value="issue">문제</option><option value="todo">할일</option><option value="question">확인</option>
          </select>
          <input className="f" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
          <select className="f" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="1">P1</option><option value="2">P2</option><option value="3">P3</option>
          </select>
          <select className="f" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
            <option value="">담당 미지정</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input className="f" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} style={{ width: 140 }} />
          <textarea className="f" rows={2} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} style={{ width: "100%" }} />
          <button className="btn btn-sm btn-primary" disabled={pending}
            onClick={async () => {
              const r = await pmUpdateTaskAction(brandId, t.id, {
                kind: f.kind, title: f.title, detail: f.detail,
                priority: Number(f.priority), owner: f.owner || null, dueDate: f.dueDate || null,
              });
              onDone(r.ok ? (r.note ?? "저장됨") : (r.error ?? "실패"));
              if (r.ok) setEdit(false);
            }}>저장</button>
        </div>
      )}
      {history && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink3)" }}>
          {history.length === 0 ? "변경 이력이 없습니다." : history.map((h, i) => (
            <div key={i}>{ts(h.at)} · {h.field}: {h.oldValue || "—"} → {h.newValue || "—"} ({h.actor})</div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskForm({ brandId, admins, pending, onDone }: { brandId: string; admins: { id: string; name: string }[]; pending: boolean; onDone: (m: string) => void }) {
  const [f, setF] = useState({ kind: "todo", title: "", priority: "2", owner: "", dueDate: "" });
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      <select className="f" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        <option value="todo">할일</option><option value="issue">문제</option><option value="question">확인</option>
      </select>
      <input className="f" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목" style={{ flex: 1, minWidth: 180 }} />
      <select className="f" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
        <option value="1">P1</option><option value="2">P2</option><option value="3">P3</option>
      </select>
      <select className="f" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
        <option value="">담당 미지정</option>
        {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input className="f" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} style={{ width: 140 }} />
      <button data-testid="pm-task-add" className="btn btn-sm btn-primary" disabled={pending || !f.title.trim()}
        onClick={async () => {
          const r = await pmCreateTaskAction(brandId, {
            kind: f.kind as Task["kind"], title: f.title, priority: Number(f.priority),
            owner: f.owner || null, dueDate: f.dueDate || null,
          });
          onDone(r.ok ? (r.note ?? "등록됨") : (r.error ?? "실패"));
          if (r.ok) setF({ kind: "todo", title: "", priority: "2", owner: "", dueDate: "" });
        }}>＋ 등록</button>
    </div>
  );
}

function ManualCommForm({ brandId, pending, onDone }: { brandId: string; pending: boolean; onDone: (m: string) => void }) {
  const [o, setO] = useState(false);
  const [f, setF] = useState({ channel: "kakao", occurredAt: "", author: "", sourceLabel: "", sourceUrl: "", body: "" });
  if (!o) {
    return (
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
        <button className="btn btn-sm" onClick={() => setO(true)}>＋ 수집 미연결 채널 원문 등록(Slack·카톡·통화 등)</button>
        <div style={{ color: "var(--ink3)", fontSize: 11, marginTop: 3 }}>
          자동 수집이 없는 채널의 대화는 사람이 원문을 등록해야 추적됩니다 — 채널·출처·대화 시각·작성자를 함께 남깁니다.
        </div>
      </div>
    );
  }
  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <select className="f" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
          <option value="kakao">카카오톡</option><option value="slack">Slack</option><option value="call">통화</option>
          <option value="sms">문자</option><option value="offline">대면</option><option value="other">기타</option>
        </select>
        <input className="f" type="datetime-local" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} style={{ width: 200 }} />
        <input className="f" value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} placeholder="작성자(말한 사람)" style={{ width: 150 }} />
        <input className="f" value={f.sourceLabel} onChange={(e) => setF({ ...f, sourceLabel: e.target.value })} placeholder="원문 출처 설명" style={{ width: 180 }} />
        <input className="f" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} placeholder="원문 링크(선택)" style={{ flex: 1, minWidth: 160 }} />
      </div>
      <textarea className="f" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="대화 원문" />
      <div style={{ display: "flex", gap: 4 }}>
        <button data-testid="pm-comm-add" className="btn btn-sm btn-primary" disabled={pending || !f.occurredAt}
          onClick={async () => {
            const r = await pmAddCommAction(brandId, {
              channel: f.channel, occurredAt: f.occurredAt, author: f.author,
              sourceLabel: f.sourceLabel, sourceUrl: f.sourceUrl, body: f.body,
            });
            onDone(r.ok ? (r.note ?? "등록됨") : (r.error ?? "실패"));
            if (r.ok) { setO(false); setF({ channel: "kakao", occurredAt: "", author: "", sourceLabel: "", sourceUrl: "", body: "" }); }
          }}>등록</button>
        <button className="btn btn-sm" onClick={() => setO(false)}>취소</button>
      </div>
    </div>
  );
}

function QaFixture({ pending, onDone }: { pending: boolean; onDone: (m: string) => void }) {
  const [res, setRes] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 8 }}>
      <button data-testid="pm-qa-fixture" className="btn btn-sm" disabled={pending}
        onClick={async () => {
          const r = await pmQaFixtureAction();
          setRes(r.ok
            ? { ok: true, text: `${r.brandName} · ${r.note ?? ""}`, url: r.brandId ? `/brand/${r.brandId}` : undefined }
            : { ok: false, text: r.error ?? "실패" });
          onDone(r.ok ? (r.note ?? "생성됨") : (r.error ?? "실패"));
        }}>검수용 테스트 브랜드 만들기(대표 전용)</button>
      <div style={{ color: "var(--ink3)", fontSize: 11, marginTop: 3 }}>
        <b>is_test=true · state=dropped · 연락처 없음 · PM 자동 운영 OFF</b> 인 합성 브랜드에만 KPI·업무·수동대화 샘플을 만듭니다.
        (state=dropped 이므로 SLA·일일 운영 점검·고객 보고 집계에서 제외됩니다.)
        실제 고객 브랜드는 만들거나 수정하지 않습니다.
      </div>
      {res && (
        <div style={{ marginTop: 4, color: res.ok ? "#0b7a52" : "#c92a2a" }}>
          {res.text}{res.url && <> · <a href={res.url}>테스트 브랜드 열기 →</a></>}
        </div>
      )}
    </div>
  );
}
