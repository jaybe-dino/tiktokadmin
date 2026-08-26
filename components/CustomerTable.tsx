"use client";
// 브랜드 원장 테이블 — 체크박스 일괄삭제 + 리드추가/최근업데이트 날짜 컬럼.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GradeBadge, PayBadge, PlanBadge, StateBadge } from "@/components/badges";
import { businessDaysBetween } from "@/lib/time";
import { SOURCE_LABELS, STATE_LABELS, STATES } from "@/lib/types";
import { deleteBrandsAction, dropBrandsAction, assignBrandOwnerAction, transitionAction, setBrandMetaAction } from "@/app/actions";
import { GRADES, PLANS, PLAN_LABELS } from "@/lib/types";
import type { OwnerField, State } from "@/lib/types";
import CopyButton from "@/components/CopyButton";

type Row = Record<string, unknown>;

// 중복 후보 탐지(현재 페이지 내) — 이메일/전화/사업자번호 정규화 키가 겹치면 표시.
function norm(v: unknown): string { return String(v ?? "").toLowerCase().replace(/[\s\-().]/g, "").trim(); }
function dupKeys(rows: Row[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) {
    for (const k of [norm(r.email), norm(r.phone), norm(r.biz_no)]) {
      if (k.length >= 5) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  const dup = new Set<string>();
  for (const [k, n] of seen) if (n > 1) dup.add(k);
  return dup;
}

// 일괄 배정 가능한 담당 역할.
const ASSIGN_ROLES: { value: OwnerField; label: string }[] = [
  { value: "owner_intake", label: "유입담당" },
  { value: "owner_sales", label: "영업담당" },
  { value: "owner_onboard", label: "온보딩담당" },
  { value: "owner_ads", label: "광고담당" },
  { value: "owner_contract", label: "계약담당" },
];

// 경과일은 영업일(주말 제외) 기준 — 파이프라인 보드·SLA 정책과 동일 기준(BUG-18).
function sinceLabel(iso: unknown): { text: string; danger: boolean } {
  if (!iso) return { text: "—", danger: false };
  const t = new Date(String(iso)).getTime();
  if (Number.isNaN(t)) return { text: "—", danger: false };
  const days = businessDaysBetween(new Date(t), new Date());
  if (days <= 0) return { text: "오늘", danger: false };
  if (days === 1) return { text: "1영업일 전", danger: false };
  return { text: `${days}영업일 전`, danger: days >= 5 };
}
function ymd(iso: unknown): string {
  if (!iso) return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  // 날짜 + 시간(KST) — 예: 2026. 8. 4. 14:32
  // toLocaleString 은 Node(서버)와 브라우저의 ICU 로케일 출력이 미묘하게 달라(시각 앞 NBSP 등)
  // SSR 하이드레이션 불일치(React #418)를 유발한다. UTC+9 로 직접 계산해 결정론적으로 포맷한다.
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}. ${k.getUTCMonth() + 1}. ${k.getUTCDate()}. ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
function completeness(b: Row): number {
  const keys = ["brand_name", "category", "state", "grade", "plan", "source", "owner_sales", "email", "next_action"];
  const filled = keys.filter((k) => { const v = b[k]; return v !== null && v !== undefined && String(v).trim() !== ""; }).length;
  const cn = (b.countries as string[] | null)?.length ? 1 : 0;
  return Math.round(((filled + cn) / (keys.length + 1)) * 100);
}

export default function CustomerTable({ rows, canEdit, ownerNames = {}, owners = [] }: { rows: Row[]; canEdit: boolean; ownerNames?: Record<string, string>; owners?: { id: string; name: string }[] }) {
  // owner_* 에는 admin_users.id(이메일)가 저장됨 → 사람 이름으로 표기(없으면 원값). (pipeline#1)
  const nm = (id: string | null | undefined) => (id ? ownerNames[id] ?? id : null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [assignRole, setAssignRole] = useState<OwnerField>("owner_intake");
  const [assignUser, setAssignUser] = useState("");
  // 일괄 배정 진행률(브랜드별 순차 처리) — {done, total} 표시.
  const [assigning, setAssigning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [moveState, setMoveState] = useState<State | "">("");
  const [bulkGrade, setBulkGrade] = useState("");
  const [bulkPlan, setBulkPlan] = useState("");

  const dupSet = dupKeys(rows);
  const isDup = (b: Row) => [norm(b.email), norm(b.phone), norm(b.biz_no)].some((k) => k.length >= 5 && dupSet.has(k));

  const ids = rows.map((r) => String(r.id));
  const allChecked = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(ids));

  const doDrop = () => {
    if (sel.size === 0) return;
    if (!confirm(`선택한 ${sel.size}개를 목록에서 제외(dropped)할까요? (데이터는 보존, 목록에서 숨김 — 동기화 복원 방지)`)) return;
    start(async () => {
      const r = await dropBrandsAction([...sel]);
      if (r.ok) { setMsg(`${r.dropped}건 제외됨(dropped)`); setSel(new Set()); router.refresh(); }
      else setMsg(r.error ?? "실패");
    });
  };
  const doDelete = () => {
    if (sel.size === 0) return;
    if (!confirm(`선택한 ${sel.size}개를 완전 삭제할까요? (연관 데이터까지 삭제·복구 불가. glovek 원본 고객은 동기화로 되살아날 수 있음)`)) return;
    start(async () => {
      const r = await deleteBrandsAction([...sel]);
      if (r.ok) { setMsg(`${r.deleted}건 완전삭제됨`); setSel(new Set()); router.refresh(); }
      else setMsg(r.error ?? "삭제 실패");
    });
  };
  // 브랜드별로 순차 배정하며 진행률을 갱신(처리중 몇/몇 완료 표시).
  const doAssign = async () => {
    if (sel.size === 0 || assigning) return;
    if (!assignUser) { setMsg("배정할 담당자를 선택하세요."); return; }
    const ids = [...sel];
    const roleLabel = ASSIGN_ROLES.find((x) => x.value === assignRole)?.label ?? "담당";
    setMsg("");
    setAssigning(true);
    setProgress({ done: 0, total: ids.length });
    let assigned = 0, advanced = 0, failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        const r = await assignBrandOwnerAction(ids[i], assignRole, assignUser);
        if (r.ok) { assigned++; if (r.advanced) advanced++; } else failed++;
      } catch { failed++; }
      setProgress({ done: i + 1, total: ids.length });
    }
    setAssigning(false);
    setProgress(null);
    const advTxt = advanced ? ` · ${advanced}건 담당자배정 단계로 전진` : "";
    const failTxt = failed ? ` · ${failed}건 실패` : "";
    setMsg(`${assigned}건 ${roleLabel} 배정됨${advTxt}${failTxt}`);
    setSel(new Set());
    router.refresh();
  };
  // 일괄 단계 이동 — 게이트는 브랜드별로 그대로 적용(force 없음). 통과분만 이동, 실패는 집계.
  const doMove = async () => {
    if (sel.size === 0 || assigning || !moveState) return;
    const label = STATE_LABELS[moveState as State] ?? moveState;
    if (!confirm(`선택한 ${sel.size}개를 "${label}" 단계로 이동할까요? (단계 전환 조건을 통과한 건만 이동)`)) return;
    const idList = [...sel];
    setMsg(""); setAssigning(true); setProgress({ done: 0, total: idList.length });
    let moved = 0, blocked = 0, failed = 0;
    for (let i = 0; i < idList.length; i++) {
      try {
        const r = await transitionAction(idList[i], moveState as State);
        if (r.ok) moved++; else blocked++;
      } catch { failed++; }
      setProgress({ done: i + 1, total: idList.length });
    }
    setAssigning(false); setProgress(null);
    setMsg(`${moved}건 "${label}"로 이동${blocked ? ` · ${blocked}건 조건 미충족(스킵)` : ""}${failed ? ` · ${failed}건 실패` : ""}`);
    setSel(new Set());
    router.refresh();
  };
  // 일괄 등급/플랜 변경.
  const doMeta = async (patch: { grade?: string; plan?: string }, label: string) => {
    if (sel.size === 0 || assigning) return;
    const idList = [...sel];
    setMsg(""); setAssigning(true); setProgress({ done: 0, total: idList.length });
    let ok = 0, fail = 0;
    for (let i = 0; i < idList.length; i++) {
      try { const r = await setBrandMetaAction(idList[i], patch); r.ok ? ok++ : fail++; } catch { fail++; }
      setProgress({ done: i + 1, total: idList.length });
    }
    setAssigning(false); setProgress(null);
    setMsg(`${ok}건 ${label} 변경${fail ? ` · ${fail}건 실패` : ""}`);
    setSel(new Set()); router.refresh();
  };

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      {canEdit && (
        <>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>{sel.size > 0 ? `${sel.size}건 선택됨` : "행 왼쪽 체크로 선택"}</span>
          {msg && <span style={{ fontSize: 12, color: "var(--ok)" }}>{msg}</span>}

          {/* 일괄 담당자 배정 — 유입담당 배정 시 lead_new 는 담당자배정 단계로 자동 전진 */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <select className="f" style={{ width: 110, padding: "3px 6px", fontSize: 12 }} value={assignRole} onChange={(e) => setAssignRole(e.target.value as OwnerField)} title="배정 역할">
              {ASSIGN_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select className="f" style={{ width: 130, padding: "3px 6px", fontSize: 12 }} value={assignUser} onChange={(e) => setAssignUser(e.target.value)} title="배정할 담당자">
              <option value="">담당자 선택</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" disabled={pending || assigning || sel.size === 0 || !assignUser} onClick={doAssign} title="선택 브랜드에 담당자 일괄 배정">
              {assigning && progress ? `배정 중 ${progress.done}/${progress.total}` : `담당 배정${sel.size ? ` (${sel.size})` : ""}`}
            </button>
            {/* 일괄 단계 이동 — 게이트 통과분만 이동 */}
            <select className="f" style={{ width: 130, padding: "3px 6px", fontSize: 12 }} value={moveState} onChange={(e) => setMoveState(e.target.value as State | "")} title="이동할 단계">
              <option value="">단계 이동…</option>
              {STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
            </select>
            <button className="btn btn-sm" disabled={pending || assigning || sel.size === 0 || !moveState} onClick={doMove} title="선택 브랜드를 선택 단계로 일괄 이동(조건 통과분만)">
              단계 이동{sel.size ? ` (${sel.size})` : ""}
            </button>
            {/* 일괄 등급/플랜 */}
            <select className="f" style={{ width: 96, padding: "3px 6px", fontSize: 12 }} value={bulkGrade}
              onChange={(e) => { const g = e.target.value; setBulkGrade(g); if (g) doMeta({ grade: g }, `등급 ${g}`); }} title="선택 브랜드 등급 일괄 변경">
              <option value="">등급 일괄…</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="f" style={{ width: 110, padding: "3px 6px", fontSize: 12 }} value={bulkPlan}
              onChange={(e) => { const p = e.target.value; setBulkPlan(p); if (p) doMeta({ plan: p }, `플랜 ${(PLAN_LABELS as Record<string, string>)[p] ?? p}`); }} title="선택 브랜드 플랜 일괄 변경">
              <option value="">플랜 일괄…</option>
              {PLANS.map((p) => <option key={p} value={p}>{PLAN_LABELS[p] ?? p}</option>)}
            </select>
          </div>

          <button className="btn btn-sm" disabled={pending || assigning || sel.size === 0}
            onClick={doDrop} title="목록에서 제외(데이터 보존·복원 방지)">
            {pending ? "처리 중…" : `📥 선택 제외${sel.size ? ` (${sel.size})` : ""}`}
          </button>
          <button className="btn btn-sm" disabled={pending || assigning || sel.size === 0}
            style={{ color: sel.size ? "var(--danger)" : undefined }} onClick={doDelete} title="완전 삭제(테스트 데이터 정리용)">
            🗑 완전삭제
          </button>
        </div>
        {progress && (
          <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 8, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`, height: "100%", background: "var(--sales, #2563eb)", transition: "width .15s" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)", whiteSpace: "nowrap" }}>
              {progress.done}/{progress.total} 완료
            </span>
          </div>
        )}
        {assignRole === "owner_intake" && (
          <div className="note" style={{ padding: "6px 12px", fontSize: 11, color: "var(--ink3)", borderBottom: "1px solid var(--line)" }}>
            유입담당을 배정하면 <b>리드확보</b> 단계 브랜드는 <b>담당자배정</b> 단계로 자동 전진합니다.
          </div>
        )}
        </>
      )}
      <table className="t">
        <thead>
          <tr>
            {canEdit && <th style={{ width: 28 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="전체 선택" /></th>}
            <th>브랜드</th><th>상태</th><th>등급</th><th>플랜 / 결제</th><th>국가</th>
            <th>담당 (유입·영업·온보딩·계약)</th><th>리드 추가</th><th>최근 업데이트</th><th>완성도</th><th>SLA</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={canEdit ? 11 : 10} style={{ padding: "28px 12px", textAlign: "center", color: "var(--ink3)" }}>결과 없음</td></tr>
          )}
          {rows.map((b) => {
            const id = String(b.id);
            const category = (b.category as string) || "";
            const site = (b.sites as string | null)?.split(",").filter(Boolean)[0] ?? (b.brand_url as string | null) ?? "";
            const source = b.source as string;
            const sub = [category, site, SOURCE_LABELS[source] ?? source].filter(Boolean).join(" · ");
            const countries = (b.countries as string[] | null) ?? [];
            const ctyLabel = countries.length === 0 ? "—" : countries.length > 3 ? `${countries.length}개국` : countries.join("·");
            const ownerCells: { label: string; name: string | null }[] = [
              { label: "유입", name: nm(b.owner_intake as string | null) },
              { label: "영업", name: nm(b.owner_sales as string | null) },
              { label: "온보딩", name: nm(b.owner_onboard as string | null) },
              { label: "계약", name: nm(b.owner_contract as string | null) },
            ];
            const unassigned = ownerCells.every((o) => !o.name);
            const contact = sinceLabel(b.last_contact_at);
            const pct = completeness(b);
            const breach = Boolean(b.has_breach);
            const checked = sel.has(id);
            return (
              <tr key={id} style={{ background: checked ? "rgba(37,99,235,.08)" : breach ? "rgba(254,226,226,.35)" : undefined }}>
                {canEdit && <td><input type="checkbox" checked={checked} onChange={() => toggle(id)} /></td>}
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Link href={`/brand/${id}`} style={{ fontWeight: 700, color: "inherit" }}>{b.brand_name as string}</Link>
                    {isDup(b) && (
                      <Link href="/duplicates" title="이메일·전화·사업자번호가 겹치는 브랜드가 있습니다" className="chip chip-amb" style={{ fontSize: 10 }}>중복?</Link>
                    )}
                    {b.email ? <CopyButton text={String(b.email)} label="이메일" small title={`이메일 복사: ${b.email}`} /> : null}
                  </div>
                  {sub && <span className="sub">{sub}</span>}
                </td>
                <td><StateBadge state={b.state as never} /></td>
                <td><GradeBadge grade={b.grade as never} /></td>
                <td>
                  {b.plan ? <PlanBadge plan={b.plan as never} /> : <span style={{ color: "var(--ink3)" }}>—</span>}
                  <span className="sub">{b.pay_status ? <PayBadge status={b.pay_status as string} /> : "미결제"}</span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{ctyLabel}</td>
                <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {unassigned ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>미배정</span> : (
                    <div style={{ display: "grid", gap: 1 }}>
                      {ownerCells.map((o) => (
                        <div key={o.label}>
                          <span style={{ color: "var(--ink3)", marginRight: 4 }}>{o.label}</span>
                          {o.name ? <span style={{ fontWeight: 600 }}>{o.name}</span> : <span style={{ color: "var(--ink3)" }}>—</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap", color: "var(--ink3)", fontSize: 12 }}>{ymd(b.created_at)}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: 12, color: contact.danger ? "var(--danger)" : undefined }}>
                  {ymd(b.updated_at)}<span className="sub" suppressHydrationWarning>{contact.text} 접촉</span>
                </td>
                <td style={{ minWidth: 80 }}>
                  <div className="pr"><i className={pct >= 90 ? "g" : pct >= 50 ? "" : "w"} style={{ width: `${pct}%` }} /></div>
                </td>
                <td>{breach ? <span className="sla t2">위반</span> : contact.danger ? <span className="sla t1">지연</span> : <span className="sla ok">정상</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
