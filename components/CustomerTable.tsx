"use client";
// 브랜드 원장 테이블 — 체크박스 일괄삭제 + 리드추가/최근업데이트 날짜 컬럼.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GradeBadge, PayBadge, PlanBadge, StateBadge } from "@/components/badges";
import { SOURCE_LABELS } from "@/lib/types";
import { deleteBrandsAction, dropBrandsAction, bulkAssignAction } from "@/app/actions";
import type { OwnerField } from "@/lib/types";

type Row = Record<string, unknown>;

// 일괄 배정 가능한 담당 역할.
const ASSIGN_ROLES: { value: OwnerField; label: string }[] = [
  { value: "owner_intake", label: "유입담당" },
  { value: "owner_sales", label: "영업담당" },
  { value: "owner_onboard", label: "온보딩담당" },
  { value: "owner_ads", label: "광고담당" },
  { value: "owner_contract", label: "계약담당" },
];

function initials(name: string): string {
  const n = (name || "").trim();
  if (!n) return "?";
  if (/[가-힣]/.test(n)) return n.slice(0, 1);
  return n.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
}
function sinceLabel(iso: unknown): { text: string; danger: boolean } {
  if (!iso) return { text: "—", danger: false };
  const t = new Date(String(iso)).getTime();
  if (Number.isNaN(t)) return { text: "—", danger: false };
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return { text: "오늘", danger: false };
  if (days === 1) return { text: "어제", danger: false };
  return { text: `${days}일 전`, danger: days >= 7 };
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
  const doAssign = () => {
    if (sel.size === 0) return;
    if (!assignUser) { setMsg("배정할 담당자를 선택하세요."); return; }
    start(async () => {
      const r = await bulkAssignAction([...sel], assignRole, assignUser);
      if (r.ok) {
        const roleLabel = ASSIGN_ROLES.find((x) => x.value === assignRole)?.label ?? "담당";
        const advanced = r.advanced ? ` · ${r.advanced}건 담당자배정 단계로 전진` : "";
        const failed = r.failures?.length ? ` · ${r.failures.length}건 실패` : "";
        setMsg(`${r.assigned}건 ${roleLabel} 배정됨${advanced}${failed}`);
        setSel(new Set()); router.refresh();
      } else setMsg(r.error ?? "배정 실패");
    });
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
            <button className="btn btn-sm btn-primary" disabled={pending || sel.size === 0 || !assignUser} onClick={doAssign} title="선택 브랜드에 담당자 일괄 배정">
              {pending ? "처리 중…" : `담당 배정${sel.size ? ` (${sel.size})` : ""}`}
            </button>
          </div>

          <button className="btn btn-sm" disabled={pending || sel.size === 0}
            onClick={doDrop} title="목록에서 제외(데이터 보존·복원 방지)">
            {pending ? "처리 중…" : `📥 선택 제외${sel.size ? ` (${sel.size})` : ""}`}
          </button>
          <button className="btn btn-sm" disabled={pending || sel.size === 0}
            style={{ color: sel.size ? "var(--danger)" : undefined }} onClick={doDelete} title="완전 삭제(테스트 데이터 정리용)">
            🗑 완전삭제
          </button>
        </div>
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
            <th>담당 (영업·온보딩)</th><th>리드 추가</th><th>최근 업데이트</th><th>완성도</th><th>SLA</th>
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
            const ownerSales = nm(b.owner_sales as string | null);
            const ownerOnboard = nm(b.owner_onboard as string | null);
            const unassigned = !ownerSales && !ownerOnboard;
            const contact = sinceLabel(b.last_contact_at);
            const pct = completeness(b);
            const breach = Boolean(b.has_breach);
            const checked = sel.has(id);
            return (
              <tr key={id} style={{ background: checked ? "rgba(37,99,235,.08)" : breach ? "rgba(254,226,226,.35)" : undefined }}>
                {canEdit && <td><input type="checkbox" checked={checked} onChange={() => toggle(id)} /></td>}
                <td>
                  <Link href={`/brand/${id}`} style={{ fontWeight: 700, color: "inherit" }}>{b.brand_name as string}</Link>
                  {sub && <span className="sub">{sub}</span>}
                </td>
                <td><StateBadge state={b.state as never} /></td>
                <td><GradeBadge grade={b.grade as never} /></td>
                <td>
                  {b.plan ? <PlanBadge plan={b.plan as never} /> : <span style={{ color: "var(--ink3)" }}>—</span>}
                  <span className="sub">{b.pay_status ? <PayBadge status={b.pay_status as string} /> : "미결제"}</span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{ctyLabel}</td>
                <td>
                  {unassigned ? <span style={{ color: "var(--danger)", fontWeight: 700 }}>미배정</span> : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {ownerSales && <span className="av" title={`영업 ${ownerSales}`}>{initials(ownerSales)}</span>}
                      {ownerOnboard && <span className="av" title={`온보딩 ${ownerOnboard}`}>{initials(ownerOnboard)}</span>}
                      <span className="sub" style={{ display: "inline" }}>{ownerSales ?? "—"} · {ownerOnboard ?? "—"}</span>
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
