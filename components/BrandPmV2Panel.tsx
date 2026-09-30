"use client";
// 브랜드360 PM 1차 확장 패널 — 계약 조건 · KPI 분류/합의 · 대화 대조 추출 ·
//   업무 실행(버킷·대기주체·실행결과) · 내부 알림 · 히스토리 질의.
//   · 이 화면에서 브랜드사(고객)에게 보내는 버튼은 없다. 답변 초안은 담당자가 복사해 쓴다.
//   · 입력은 모두 ref + defaultValue — 값을 프로그램으로 채워도 저장에서 빠지지 않게.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KPI_KINDS, KPI_KIND_LABEL, KPI_KIND_HINT, AGREEMENTS, AGREEMENT_LABEL,
  TERM_KINDS, TERM_KIND_LABEL, TERM_STATUSES, TERM_STATUS_LABEL,
  EXTRACT_KINDS, EXTRACT_KIND_LABEL, EXTRACT_STATUS_LABEL,
  CONTRACT_CHECK_LABEL, WAITING_LABEL,
  taskBuckets, kpiGap, periodLabel,
  type KpiKind, type Agreement, type TermKind, type TermStatus, type ExtractKind,
} from "@/lib/pm-brief";
import {
  pmV2OverviewAction, pmSetKpiClassAction, pmConfirmKpiAction, pmKpiEventsAction,
  pmCreateTermAction, pmUpdateTermAction, pmConfirmTermAction, pmDeleteTermAction,
  pmRunExtractionAction, pmRecheckContractsAction, pmAddExtractionAction,
  pmEditExtractionAction, pmSetExtractionStatusAction, pmTaskFromExtractionAction,
  pmSetTaskWaitingAction, pmSetTaskKpiAction, pmSetTaskResultAction,
  pmSaveNotifyAction, pmPreviewNotifyAction, pmAskHistoryAction,
  type PmV2Overview,
} from "@/app/(dash)/brand/[id]/pm-actions";

type Res = { ok: boolean; error?: string; note?: string };

function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async <T extends Res>(fn: () => Promise<T>, after?: (r: T) => void) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.note ?? "완료") : (r.error ?? "처리하지 못했습니다.") });
      if (r.ok) after?.(r);
      return r;
    } catch (e) {
      setMsg({ ok: false, text: `오류 — ${(e as Error).message}` });
      return { ok: false, error: (e as Error).message } as T;
    } finally { setBusy(false); }
  }, []);
  return { busy, msg, run };
}
const sv = (r: React.RefObject<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>, fb = "") =>
  (typeof r.current?.value === "string" ? r.current.value : fb);
const nv = (r: React.RefObject<HTMLInputElement | HTMLSelectElement | null>): string => sv(r).trim();
const Msg = ({ m }: { m: { ok: boolean; text: string } }) => (
  <div style={{ marginTop: 6, fontSize: 12, whiteSpace: "pre-wrap", color: m.ok ? "#0b7a52" : "#c92a2a" }}>{m.text}</div>
);

export default function BrandPmV2Panel({ brandId, admins }: { brandId: string; admins: { id: string; name: string }[] }) {
  const [ov, setOv] = useState<PmV2Overview | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await pmV2OverviewAction(brandId);
    setLoading(false);
    if (!r.ok || !r.data) { setErr(r.error ?? "불러오지 못했습니다."); return; }
    setErr(""); setOv(r.data);
  }, [brandId]);
  useEffect(() => { void reload(); }, [reload]);

  if (loading && !ov) return <div className="note">불러오는 중…</div>;
  if (err) return <div className="note" style={{ color: "#c92a2a" }}>{err}</div>;
  if (!ov) return null;
  if (!ov.schemaReady) {
    return (
      <div className="note" style={{ color: "#c25400" }}>
        {ov.schemaError} — 설정 &gt; 마이그레이션에서 <b>{ov.migration}</b> 만 단독 적용하면 사용할 수 있습니다.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <ContractCard brandId={brandId} ov={ov} onDone={reload} />
      <KpiClassCard brandId={brandId} ov={ov} onDone={reload} />
      <ExtractionCard brandId={brandId} ov={ov} admins={admins} onDone={reload} />
      <WorkCard brandId={brandId} ov={ov} onDone={reload} />
      <NotifyCard ov={ov} onDone={reload} />
      <HistoryCard brandId={brandId} />
    </div>
  );
}

// ── ② 계약 조건 ─────────────────────────────────────────────
function ContractCard({ brandId, ov, onDone }: { brandId: string; ov: PmV2Overview; onDone: () => void }) {
  const a = useAction();
  const kind = useRef<HTMLSelectElement>(null);
  const label = useRef<HTMLInputElement>(null);
  const detail = useRef<HTMLTextAreaElement>(null);
  const qty = useRef<HTMLInputElement>(null);
  const unit = useRef<HTMLInputElement>(null);
  const ps = useRef<HTMLInputElement>(null);
  const pe = useRef<HTMLInputElement>(null);
  const quote = useRef<HTMLTextAreaElement>(null);
  const evLabel = useRef<HTMLInputElement>(null);

  const add = () => {
    if (!nv(label)) { return; }
    void a.run(() => pmCreateTermAction(brandId, {
      kind: sv(kind, "scope") as TermKind, label: nv(label), detail: sv(detail),
      quantity: nv(qty) === "" ? null : nv(qty), unit: nv(unit),
      periodStart: nv(ps) || null, periodEnd: nv(pe) || null,
      sourceQuote: sv(quote), evidenceLabel: nv(evLabel),
    }), () => {
      [label, qty, unit, ps, pe, evLabel].forEach((r) => { if (r.current) r.current.value = ""; });
      [detail, quote].forEach((r) => { if (r.current) r.current.value = ""; });
      onDone();
    });
  };

  return (
    <div className="card" data-testid="pm-contract">
      <div className="hd">
        <b>📜 계약 의무 · 조건</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          범위 · 수량 · 기간 · 제외 · 협조사항. 근거 없이는 확정할 수 없습니다.
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 10 }}>
        {ov.terms.length === 0 ? (
          <div className="note">등록된 계약 조건이 없습니다 — 조건이 없으면 대화 대조는 “대조 불가”로 남습니다.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="t" style={{ fontSize: 12 }}>
              <thead><tr><th>구분</th><th>항목</th><th>수량</th><th>기간</th><th>상태</th><th>근거</th><th></th></tr></thead>
              <tbody>
                {ov.terms.map((t) => <TermRow key={t.id} brandId={brandId} t={t} canWrite={ov.canWrite} onDone={onDone} />)}
              </tbody>
            </table>
          </div>
        )}

        {ov.canWrite && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12.5 }}>계약 조건 추가</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select className="f" ref={kind} defaultValue="scope" style={{ fontSize: 12 }}>
                  {TERM_KINDS.map((k) => <option key={k} value={k}>{TERM_KIND_LABEL[k]}</option>)}
                </select>
                <input className="f" ref={label} placeholder="항목 이름 (예: 월 시딩 콘텐츠)" style={{ flex: 1, minWidth: 200, fontSize: 12 }} />
                <input className="f" ref={qty} placeholder="수량(비우면 미입력)" style={{ width: 150, fontSize: 12 }} />
                <input className="f" ref={unit} placeholder="단위 (건/개월)" style={{ width: 110, fontSize: 12 }} />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>기간</span>
                <input className="f" ref={ps} type="date" style={{ fontSize: 12 }} />
                <span>~</span>
                <input className="f" ref={pe} type="date" style={{ fontSize: 12 }} />
                <input className="f" ref={evLabel} placeholder="근거 표시 (계약서 3조 등)" style={{ flex: 1, minWidth: 180, fontSize: 12 }} />
              </div>
              <textarea className="f" ref={detail} rows={2} placeholder="상세" style={{ fontSize: 12 }} />
              <textarea className="f" ref={quote} rows={2} placeholder="계약 문구 원문(그대로 붙여넣기)" style={{ fontSize: 12 }} />
              <div>
                <button className="btn sm pri" disabled={a.busy} onClick={add}>추가</button>
                <button className="btn sm" disabled={a.busy} style={{ marginLeft: 6 }}
                  onClick={() => void a.run(() => pmRecheckContractsAction(brandId), onDone)}>
                  대화와 계약 다시 대조
                </button>
              </div>
            </div>
          </details>
        )}
        {a.msg && <Msg m={a.msg} />}
      </div>
    </div>
  );
}

function TermRow({ brandId, t, canWrite, onDone }:
  { brandId: string; t: PmV2Overview["terms"][number]; canWrite: boolean; onDone: () => void }) {
  const a = useAction();
  const status = useRef<HTMLSelectElement>(null);
  return (
    <tr>
      <td>{TERM_KIND_LABEL[t.kind]}</td>
      <td><b>{t.label}</b>{t.detail && <div style={{ color: "var(--ink3)", fontSize: 11 }}>{t.detail}</div>}</td>
      <td>{t.quantity === null ? <span style={{ color: "var(--ink3)" }}>미입력</span> : `${t.quantity}${t.unit}`}</td>
      <td>{periodLabel({ periodStart: t.periodStart, periodEnd: t.periodEnd })}</td>
      <td>
        {canWrite ? (
          <select className="f" ref={status} defaultValue={t.status} style={{ fontSize: 11.5 }}
            onChange={() => void a.run(() => pmUpdateTermAction(brandId, t.id, {
              kind: t.kind, label: t.label, detail: t.detail, quantity: t.quantity, unit: t.unit,
              periodStart: t.periodStart, periodEnd: t.periodEnd,
              status: sv(status, t.status) as TermStatus,
              evidenceLabel: t.evidenceLabel, evidenceUrl: t.evidenceUrl,
              sourceQuote: t.sourceQuote, sourceAuthor: t.sourceAuthor,
            }), onDone)}>
            {TERM_STATUSES.map((s) => <option key={s} value={s}>{TERM_STATUS_LABEL[s]}</option>)}
          </select>
        ) : TERM_STATUS_LABEL[t.status]}
      </td>
      <td style={{ maxWidth: 220 }}>
        <div style={{ fontSize: 11, color: "var(--ink3)" }}>{t.evidenceLabel || "표시 없음"}</div>
        {t.sourceQuote && <div style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>“{t.sourceQuote.slice(0, 160)}”</div>}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {canWrite && t.status !== "agreed" && (
          <button className="btn sm" disabled={a.busy} onClick={() => void a.run(() => pmConfirmTermAction(brandId, t.id), onDone)}>확정</button>
        )}
        {canWrite && (
          <button className="btn sm" disabled={a.busy} style={{ color: "#c92a2a", marginLeft: 4 }}
            onClick={() => { if (confirm(`'${t.label}' 계약 조건을 삭제할까요?`)) void a.run(() => pmDeleteTermAction(brandId, t.id), onDone); }}>삭제</button>
        )}
        {a.msg && !a.msg.ok && <div style={{ fontSize: 11, color: "#c92a2a" }}>{a.msg.text}</div>}
      </td>
    </tr>
  );
}

// ── ② KPI 분류·합의 ─────────────────────────────────────────
function KpiClassCard({ brandId, ov, onDone }: { brandId: string; ov: PmV2Overview; onDone: () => void }) {
  return (
    <div className="card" data-testid="pm-kpi-class">
      <div className="hd">
        <b>🎯 KPI 구분 · 합의 상태</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          계약 의무 / 브랜드 기대 / 내부 실행을 분리합니다. 대화에서 뽑은 후보는 담당 확인으로만 합의가 됩니다.
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 8 }}>
        {ov.kpis.length === 0 ? (
          <div className="note">등록된 KPI 가 없습니다 — 위 PM 탭의 KPI 칸에서 먼저 추가하세요.</div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>
              {KPI_KINDS.map((k) => `${KPI_KIND_LABEL[k]}=${KPI_KIND_HINT[k]}`).join(" · ")}
            </div>
            {ov.kpis.map((k) => <KpiRow key={k.id} brandId={brandId} k={k} canWrite={ov.canWrite} onDone={onDone} />)}
          </>
        )}
      </div>
    </div>
  );
}

function KpiRow({ brandId, k, canWrite, onDone }:
  { brandId: string; k: PmV2Overview["kpis"][number]; canWrite: boolean; onDone: () => void }) {
  const a = useAction();
  const kind = useRef<HTMLSelectElement>(null);
  const agree = useRef<HTMLSelectElement>(null);
  const quote = useRef<HTMLTextAreaElement>(null);
  const [events, setEvents] = useState<{ field: string; oldValue: string; newValue: string; actor: string; at: string }[] | null>(null);
  const gap = kpiGap(k);

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
        <b>{k.name}</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          목표 {k.target === null ? "미입력" : `${k.target}${k.unit}`} · 현재 {k.current === null ? "미확인" : `${k.current}${k.unit}`} ·
          차이 {gap === null ? "산출 불가" : `${gap}${k.unit}`} · {periodLabel(k)} · 기준일 {k.measuredAt ?? "미기재"} ·
          담당 {k.owner ?? "미배정"}
        </span>
        {k.agreement !== "agreed" && <span className="cellchip cc-warn">{AGREEMENT_LABEL[k.agreement]}</span>}
        {canWrite && k.agreement !== "agreed" && (
          <button className="btn sm" style={{ marginLeft: "auto" }} disabled={a.busy}
            onClick={() => void a.run(() => pmConfirmKpiAction(brandId, k.id), onDone)}>담당 확인 → 합의</button>
        )}
        <button className="btn sm" disabled={a.busy} style={k.agreement !== "agreed" ? undefined : { marginLeft: "auto" }}
          onClick={() => void a.run(async () => {
            const r = await pmKpiEventsAction(brandId, k.id);
            if (r.ok) setEvents(r.events ?? []);
            return r;
          })}>이력</button>
      </div>
      {canWrite && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <select className="f" ref={kind} defaultValue={k.kind} style={{ fontSize: 12 }}>
            {KPI_KINDS.map((x) => <option key={x} value={x}>{KPI_KIND_LABEL[x]}</option>)}
          </select>
          <select className="f" ref={agree} defaultValue={k.agreement} style={{ fontSize: 12 }}>
            {AGREEMENTS.map((x) => <option key={x} value={x}>{AGREEMENT_LABEL[x]}</option>)}
          </select>
          <textarea className="f" ref={quote} defaultValue={k.sourceQuote} rows={2}
            placeholder="근거 원문(회의·메일 문구 그대로)" style={{ flex: 1, minWidth: 220, fontSize: 12 }} />
          <button className="btn sm" disabled={a.busy}
            onClick={() => void a.run(() => pmSetKpiClassAction(brandId, k.id, {
              kind: sv(kind, k.kind) as KpiKind,
              agreement: sv(agree, k.agreement) as Agreement,
              sourceQuote: sv(quote, k.sourceQuote),
            }), onDone)}>저장</button>
        </div>
      )}
      {a.msg && <Msg m={a.msg} />}
      {events && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink2)" }}>
          {events.length === 0 ? "변경 이력이 없습니다." : events.map((e, i) => (
            <div key={i}>{e.at?.slice(0, 16).replace("T", " ")} · {e.field} {e.oldValue || "(없음)"} → {e.newValue} · {e.actor}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ③ 대화 대조 추출 ────────────────────────────────────────
function ExtractionCard({ brandId, ov, admins, onDone }:
  { brandId: string; ov: PmV2Overview; admins: { id: string; name: string }[]; onDone: () => void }) {
  const run = useAction();
  const add = useAction();
  const kind = useRef<HTMLSelectElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const quote = useRef<HTMLTextAreaElement>(null);
  const author = useRef<HTMLInputElement>(null);
  const label = useRef<HTMLInputElement>(null);
  const [showAll, setShowAll] = useState(false);

  const list = showAll ? ov.extractions : ov.extractions.filter((e) => e.status === "new" || e.status === "confirmed");
  const conflicts = ov.extractions.filter((e) => e.contractCheck === "conflict" && e.status !== "dismissed").length;

  return (
    <div className="card" data-testid="pm-extractions">
      <div className="hd">
        <b>🔎 대화 ↔ 계약 대조</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          질문 · 요청 · 약속 · 결정 · 미해결을 원문 근거와 함께 뽑고, 계약 조건과 대조합니다.
          답변 초안은 내부 검토용이며 이 화면에서 고객에게 발송하지 않습니다.
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {ov.canWrite && (
            <button className="btn sm pri" disabled={run.busy}
              onClick={() => void run.run(() => pmRunExtractionAction(brandId), onDone)}>
              {run.busy ? "읽는 중…" : "대화 읽고 추출"}
            </button>
          )}
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 처리된 항목도 보기
          </label>
          {conflicts > 0 && <span className="cellchip cc-no">계약 충돌 {conflicts}</span>}
        </div>
        {run.msg && <Msg m={run.msg} />}

        {list.length === 0 ? (
          <div className="note">추출된 항목이 없습니다.</div>
        ) : list.map((e) => (
          <ExtractionRow key={e.id} brandId={brandId} e={e} admins={admins} kpis={ov.kpis} canWrite={ov.canWrite} onDone={onDone} />
        ))}

        {ov.canWrite && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12.5 }}>수동으로 항목 추가(원문 근거 직접 입력)</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select className="f" ref={kind} defaultValue="request" style={{ fontSize: 12 }}>
                  {EXTRACT_KINDS.map((k) => <option key={k} value={k}>{EXTRACT_KIND_LABEL[k]}</option>)}
                </select>
                <input className="f" ref={title} placeholder="제목" style={{ flex: 1, minWidth: 200, fontSize: 12 }} />
                <input className="f" ref={author} placeholder="작성자" style={{ width: 130, fontSize: 12 }} />
                <input className="f" ref={label} placeholder="출처(카톡 2/3 등)" style={{ width: 180, fontSize: 12 }} />
              </div>
              <textarea className="f" ref={quote} rows={2} placeholder="원문 인용(그대로 붙여넣기)" style={{ fontSize: 12 }} />
              <div>
                <button className="btn sm" disabled={add.busy}
                  onClick={() => {
                    if (!nv(title)) return;
                    void add.run(() => pmAddExtractionAction(brandId, {
                      kind: sv(kind, "request") as ExtractKind, title: nv(title),
                      sourceQuote: sv(quote), sourceAuthor: nv(author), evidenceLabel: nv(label),
                      evidenceKind: "manual",
                    }), () => {
                      [title, author, label].forEach((r) => { if (r.current) r.current.value = ""; });
                      if (quote.current) quote.current.value = "";
                      onDone();
                    });
                  }}>추가</button>
              </div>
              {add.msg && <Msg m={add.msg} />}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function ExtractionRow({ brandId, e, admins, kpis, canWrite, onDone }: {
  brandId: string; e: PmV2Overview["extractions"][number];
  admins: { id: string; name: string }[]; kpis: PmV2Overview["kpis"];
  canWrite: boolean; onDone: () => void;
}) {
  const a = useAction();
  const draft = useRef<HTMLTextAreaElement>(null);
  const checks = useRef<HTMLTextAreaElement>(null);
  const owner = useRef<HTMLSelectElement>(null);
  const due = useRef<HTMLInputElement>(null);
  const kpi = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState(e.contractCheck === "conflict");

  const badge = e.contractCheck === "conflict" ? "cc-no" : e.contractCheck === "within" ? "cc-ok" : "cc-warn";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="chip" style={{ fontSize: 10.5 }}>{EXTRACT_KIND_LABEL[e.kind]}</span>
        <b style={{ fontSize: 13 }}>{e.title}</b>
        <span className={`cellchip ${badge}`}>{CONTRACT_CHECK_LABEL[e.contractCheck as keyof typeof CONTRACT_CHECK_LABEL] ?? e.contractCheck}</span>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>
          {EXTRACT_STATUS_LABEL[e.status] ?? e.status} · {e.origin === "ai" ? "AI 추출" : e.origin === "human" ? "직접 등록" : "규칙"}
          {e.editedByHuman && " · 사람 수정"}
        </span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setOpen((s) => !s)}>{open ? "접기" : "자세히"}</button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 3 }}>
        근거 {e.evidenceLabel || "표시 없음"}{e.sourceAuthor && ` · ${e.sourceAuthor}`}
      </div>
      {e.sourceQuote && (
        <div style={{ fontSize: 12, marginTop: 4, whiteSpace: "pre-wrap", background: "var(--bg)", borderRadius: 8, padding: "6px 8px" }}>
          “{e.sourceQuote}”
        </div>
      )}
      {e.contractNote && <div style={{ fontSize: 11.5, color: "#c25400", marginTop: 4 }}>계약 대조: {e.contractNote}</div>}

      {open && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {e.detail && <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{e.detail}</div>}
          <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>답변 초안 (고객에게 자동 발송되지 않습니다 — 확인 후 담당자가 직접 보냅니다)</div>
          <textarea className="f" ref={draft} defaultValue={e.replyDraft} rows={4} disabled={!canWrite} style={{ fontSize: 12 }} />
          <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>내부 확인사항</div>
          <textarea className="f" ref={checks} defaultValue={e.internalChecks} rows={3} disabled={!canWrite} style={{ fontSize: 12 }} />
          {canWrite && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn sm" disabled={a.busy}
                onClick={() => void a.run(() => pmEditExtractionAction(brandId, e.id, {
                  replyDraft: sv(draft, e.replyDraft), internalChecks: sv(checks, e.internalChecks),
                }), onDone)}>초안 저장</button>
              <button className="btn sm" disabled={a.busy}
                onClick={() => { void navigator.clipboard?.writeText(sv(draft, e.replyDraft)); }}>초안 복사</button>
              {e.status === "new" && (
                <button className="btn sm" disabled={a.busy}
                  onClick={() => void a.run(() => pmSetExtractionStatusAction(brandId, e.id, "confirmed"), onDone)}>담당 확인</button>
              )}
              {e.status !== "answered" && (
                <button className="btn sm" disabled={a.busy}
                  onClick={() => void a.run(() => pmSetExtractionStatusAction(brandId, e.id, "answered"), onDone)}>처리 완료</button>
              )}
              {e.status !== "dismissed" && (
                <button className="btn sm" disabled={a.busy} style={{ color: "#c25400" }}
                  onClick={() => void a.run(() => pmSetExtractionStatusAction(brandId, e.id, "dismissed"), onDone)}>해당 없음</button>
              )}
            </div>
          )}
          {canWrite && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              {e.taskId ? (
                <span style={{ fontSize: 12, color: "#0b7a52" }}>이 항목으로 만든 업무가 이미 있습니다 — 중복으로 만들지 않습니다.</span>
              ) : (
                <>
                  <select className="f" ref={owner} defaultValue="" style={{ fontSize: 12 }}>
                    <option value="">담당 미지정</option>
                    {admins.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input className="f" ref={due} type="date" style={{ fontSize: 12 }} />
                  <select className="f" ref={kpi} defaultValue="" style={{ fontSize: 12 }}>
                    <option value="">KPI 연결 없음</option>
                    {kpis.filter((k) => k.status === "active").map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                  <button className="btn sm pri" disabled={a.busy}
                    onClick={() => void a.run(() => pmTaskFromExtractionAction(brandId, e.id, {
                      owner: nv(owner) || null, dueDate: nv(due) || null, kpiId: nv(kpi) || null,
                      waitingOn: e.kind === "question" || e.kind === "request" ? "none" : "none",
                    }), onDone)}>담당 업무 만들기</button>
                </>
              )}
            </div>
          )}
          {a.msg && <Msg m={a.msg} />}
        </div>
      )}
    </div>
  );
}

// ── ④ 업무 실행 ─────────────────────────────────────────────
function WorkCard({ brandId, ov, onDone }: { brandId: string; ov: PmV2Overview; onDone: () => void }) {
  const b = taskBuckets(ov.tasks);
  const byId = new Map(ov.taskDetail.map((t) => [t.id, t]));
  const groups: { key: string; label: string; items: typeof ov.tasks }[] = [
    { key: "overdue", label: "지연", items: b.overdue },
    { key: "today", label: "오늘", items: b.today },
    { key: "week", label: "이번주", items: b.week },
    { key: "customer", label: "고객 대기", items: b.waitingCustomer },
    { key: "internal", label: "내부 대기", items: b.waitingInternal },
  ];
  return (
    <div className="card" data-testid="pm-work">
      <div className="hd">
        <b>🗂 업무 실행</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          대화 → KPI → 담당 업무 → 실행결과. 완료 근거 없이는 완료로 넘기지 않습니다.
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12 }}>
          {groups.map((g) => <span key={g.key} style={{ marginRight: 10 }}>{g.label} <b>{g.items.length}</b></span>)}
          <span>담당 미배정 <b style={{ color: b.unassigned.length ? "#c92a2a" : undefined }}>{b.unassigned.length}</b></span>
        </div>
        {groups.filter((g) => g.items.length > 0).map((g) => (
          <div key={g.key}>
            <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>{g.label}</div>
            <div style={{ display: "grid", gap: 6 }}>
              {g.items.map((t) => (
                <TaskRow key={t.id} brandId={brandId} t={t} detail={byId.get(t.id)} kpis={ov.kpis} canWrite={ov.canWrite} onDone={onDone} />
              ))}
            </div>
          </div>
        ))}
        {ov.tasks.length === 0 && <div className="note">등록된 업무가 없습니다.</div>}
      </div>
    </div>
  );
}

function TaskRow({ brandId, t, detail, kpis, canWrite, onDone }: {
  brandId: string; t: PmV2Overview["tasks"][number];
  detail: PmV2Overview["taskDetail"][number] | undefined;
  kpis: PmV2Overview["kpis"]; canWrite: boolean; onDone: () => void;
}) {
  const a = useAction();
  const wait = useRef<HTMLSelectElement>(null);
  const kpi = useRef<HTMLSelectElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const ev = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 9 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
        <b>{t.title}</b>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>
          {t.dueDate ? `마감 ${t.dueDate}` : "마감 없음"} · {t.owner ?? "담당 미배정"} ·
          {" "}{WAITING_LABEL[t.waitingOn] ?? t.waitingOn}
          {detail?.kpiName && ` · KPI ${detail.kpiName}`}
        </span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setOpen((s) => !s)}>{open ? "접기" : "실행결과"}</button>
      </div>
      {open && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {canWrite && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>대기 주체</span>
              <select className="f" ref={wait} defaultValue={t.waitingOn} style={{ fontSize: 12 }}
                onChange={() => void a.run(() => pmSetTaskWaitingAction(brandId, t.id, sv(wait, t.waitingOn)), onDone)}>
                {["none", "customer", "internal"].map((w) => <option key={w} value={w}>{WAITING_LABEL[w]}</option>)}
              </select>
              <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>KPI</span>
              <select className="f" ref={kpi} defaultValue={detail?.kpiId ?? ""} style={{ fontSize: 12 }}
                onChange={() => void a.run(() => pmSetTaskKpiAction(brandId, t.id, nv(kpi) || null), onDone)}>
                <option value="">연결 없음</option>
                {kpis.filter((k) => k.status === "active").map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </div>
          )}
          <textarea className="f" ref={note} defaultValue={detail?.resultNote ?? ""} rows={2}
            disabled={!canWrite} placeholder="무엇을 했는지(실행결과)" style={{ fontSize: 12 }} />
          <input className="f" ref={ev} defaultValue={detail?.resultEvidence ?? ""}
            disabled={!canWrite} placeholder="완료 근거 (메일·회의·화면 링크 등) — 완료 처리에 필요" style={{ fontSize: 12 }} />
          {detail?.resultAt && <div style={{ fontSize: 11, color: "var(--ink3)" }}>완료 {detail.resultAt.slice(0, 16).replace("T", " ")}</div>}
          {canWrite && (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn sm" disabled={a.busy}
                onClick={() => void a.run(() => pmSetTaskResultAction(brandId, t.id, {
                  resultNote: sv(note), resultEvidence: nv(ev),
                }), onDone)}>결과 저장</button>
              <button className="btn sm pri" disabled={a.busy}
                onClick={() => void a.run(() => pmSetTaskResultAction(brandId, t.id, {
                  resultNote: sv(note), resultEvidence: nv(ev), complete: true,
                }), onDone)}>근거와 함께 완료</button>
            </div>
          )}
          {a.msg && <Msg m={a.msg} />}
        </div>
      )}
    </div>
  );
}

// ── ⑤ 내부 알림 ─────────────────────────────────────────────
function NotifyCard({ ov, onDone }: { ov: PmV2Overview; onDone: () => void }) {
  const a = useAction();
  const p = useAction();
  const recips = useRef<HTMLInputElement>(null);
  const dh = useRef<HTMLInputElement>(null), dm = useRef<HTMLInputElement>(null);
  const wd = useRef<HTMLSelectElement>(null), wh = useRef<HTMLInputElement>(null), wm = useRef<HTMLInputElement>(null);
  const n = ov.notify;
  const [urgent, setUrgent] = useState(n?.urgentEnabled ?? false);
  const [daily, setDaily] = useState(n?.dailyEnabled ?? false);
  const [weekly, setWeekly] = useState(n?.weeklyEnabled ?? false);
  if (!n) return null;

  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  return (
    <div className="card" data-testid="pm-notify">
      <div className="hd">
        <b>🔔 담당자 내부 안내</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          수신자는 등록된 담당자(Slack DM)만입니다 — 브랜드사에는 나가지 않습니다. 같은 기간·수신자에게 두 번 보내지 않습니다.
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`cellchip ${n.enabled ? "cc-ok" : "cc-no"}`} data-testid="pm-notify-master">
            실제 발송 {n.enabled ? "ON" : "OFF"}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>
            수신자 {n.recipients.length === 0 ? "미지정" : n.recipients.join(", ")}
          </span>
        </div>
        {n.recipients.length === 0 && (
          <div className="note" style={{ color: "#c25400" }}>
            수신자가 정해지지 않아 실제 발송은 켜지지 않습니다 — 미리보기로만 확인할 수 있습니다.
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input className="f" ref={recips} defaultValue={n.recipients.join(", ")}
            placeholder="수신자 담당자 계정(쉼표로 구분)" style={{ flex: 1, minWidth: 240, fontSize: 12 }} />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
          <label><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 긴급</label>
          <label><input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} /> 일간</label>
          <input className="f" ref={dh} defaultValue={String(n.dailyHour)} style={{ width: 52, fontSize: 12 }} />:
          <input className="f" ref={dm} defaultValue={String(n.dailyMinute)} style={{ width: 52, fontSize: 12 }} />
          <label style={{ marginLeft: 8 }}><input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /> 주간</label>
          <select className="f" ref={wd} defaultValue={String(n.weeklyWeekday)} style={{ fontSize: 12 }}>
            {WEEK.map((w, i) => <option key={w} value={String(i)}>{w}</option>)}
          </select>
          <input className="f" ref={wh} defaultValue={String(n.weeklyHour)} style={{ width: 52, fontSize: 12 }} />:
          <input className="f" ref={wm} defaultValue={String(n.weeklyMinute)} style={{ width: 52, fontSize: 12 }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" disabled={a.busy}
            onClick={() => void a.run(() => pmSaveNotifyAction({
              recipients: sv(recips, n.recipients.join(",")).split(",").map((x) => x.trim()).filter(Boolean),
              urgentEnabled: urgent, dailyEnabled: daily, weeklyEnabled: weekly,
              dailyHour: Number(sv(dh, String(n.dailyHour))) || 0,
              dailyMinute: Number(sv(dm, String(n.dailyMinute))) || 0,
              weeklyWeekday: Number(sv(wd, String(n.weeklyWeekday))) || 0,
              weeklyHour: Number(sv(wh, String(n.weeklyHour))) || 0,
              weeklyMinute: Number(sv(wm, String(n.weeklyMinute))) || 0,
            }), onDone)}>설정 저장</button>
          <button className="btn sm" disabled={a.busy}
            onClick={() => {
              if (!n.enabled && !confirm("내부 안내 실제 발송을 켭니다. 등록된 담당자에게 Slack DM 이 갑니다.\n진행할까요?")) return;
              void a.run(() => pmSaveNotifyAction({ enabled: !n.enabled }), onDone);
            }} style={{ color: n.enabled ? "#c25400" : "#0b7a52" }}>
            {n.enabled ? "발송 끄기" : "발송 켜기"}
          </button>
          {(["urgent", "daily", "weekly"] as const).map((k) => (
            <button key={k} className="btn sm" disabled={p.busy}
              onClick={() => void p.run(() => pmPreviewNotifyAction(k), onDone)}>
              {k === "urgent" ? "긴급" : k === "daily" ? "일간" : "주간"} 미리보기
            </button>
          ))}
        </div>
        {a.msg && <Msg m={a.msg} />}
        {p.msg && <Msg m={p.msg} />}
        {ov.notifyLog.length > 0 && (
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            <table className="t" style={{ fontSize: 11.5 }}>
              <thead><tr><th>시각</th><th>종류</th><th>수신자</th><th>상태</th><th>항목</th><th>사유</th></tr></thead>
              <tbody>
                {ov.notifyLog.map((l) => (
                  <tr key={l.id}>
                    <td>{l.created_at?.slice(0, 16).replace("T", " ")}</td>
                    <td>{l.kind}</td>
                    <td>{l.recipient}</td>
                    <td>{l.status}</td>
                    <td>{l.item_count}</td>
                    <td style={{ color: "var(--ink3)" }}>{l.error || l.skip_reason}</td>
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

// ── ⑤ 히스토리 질의 ────────────────────────────────────────
function HistoryCard({ brandId }: { brandId: string }) {
  const a = useAction();
  const q = useRef<HTMLInputElement>(null);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState("");
  return (
    <div className="card" data-testid="pm-history">
      <div className="hd">
        <b>💬 브랜드 히스토리 질의</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          저장된 기록으로만 답합니다. 근거·기준 시각·확인 필요한 부분을 함께 표시합니다. (Slack 에서는 <code>/pm</code>)
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="f" ref={q} placeholder="예: 인증 서류 어디까지 받았나요?" style={{ flex: 1, minWidth: 240, fontSize: 12 }} />
          <button className="btn sm pri" disabled={a.busy}
            onClick={() => void a.run(async () => {
              const r = await pmAskHistoryAction(brandId, nv(q));
              if (r.ok) { setAnswer(r.answer ?? ""); setMode(r.mode ?? ""); }
              return r;
            })}>{a.busy ? "찾는 중…" : "물어보기"}</button>
        </div>
        {a.msg && !a.msg.ok && <Msg m={a.msg} />}
        {answer && (
          <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", background: "var(--bg)", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 4 }}>
              {mode === "ai" ? "대화 원문을 읽고 답했습니다" : "AI 없이 저장된 현황만 정리했습니다"}
            </div>
            {answer}
          </div>
        )}
      </div>
    </div>
  );
}
