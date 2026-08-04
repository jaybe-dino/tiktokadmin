"use client";
// 브랜드 원장 테이블 — 체크박스 일괄삭제 + 리드추가/최근업데이트 날짜 컬럼.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GradeBadge, PayBadge, PlanBadge, StateBadge } from "@/components/badges";
import { SOURCE_LABELS } from "@/lib/types";
import { deleteBrandsAction } from "@/app/actions";

type Row = Record<string, unknown>;

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
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}
function completeness(b: Row): number {
  const keys = ["brand_name", "category", "state", "grade", "plan", "source", "owner_sales", "email", "next_action"];
  const filled = keys.filter((k) => { const v = b[k]; return v !== null && v !== undefined && String(v).trim() !== ""; }).length;
  const cn = (b.countries as string[] | null)?.length ? 1 : 0;
  return Math.round(((filled + cn) / (keys.length + 1)) * 100);
}

export default function CustomerTable({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");

  const ids = rows.map((r) => String(r.id));
  const allChecked = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(ids));

  const doDelete = () => {
    if (sel.size === 0) return;
    if (!confirm(`선택한 ${sel.size}개 브랜드를 삭제할까요? (연관 데이터도 함께 삭제, 되돌릴 수 없음)`)) return;
    start(async () => {
      const r = await deleteBrandsAction([...sel]);
      if (r.ok) { setMsg(`${r.deleted}건 삭제됨`); setSel(new Set()); router.refresh(); }
      else setMsg(r.error ?? "삭제 실패");
    });
  };

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>{sel.size > 0 ? `${sel.size}건 선택됨` : "행 왼쪽 체크로 선택"}</span>
          <button className="btn btn-sm" disabled={pending || sel.size === 0}
            style={{ marginLeft: "auto", color: sel.size ? "var(--danger)" : undefined }} onClick={doDelete}>
            {pending ? "삭제 중…" : `🗑 선택 삭제${sel.size ? ` (${sel.size})` : ""}`}
          </button>
          {msg && <span style={{ fontSize: 12, color: "var(--ok)" }}>{msg}</span>}
        </div>
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
            const ownerSales = b.owner_sales as string | null;
            const ownerOnboard = b.owner_onboard as string | null;
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
                  {ymd(b.updated_at)}<span className="sub">{contact.text} 접촉</span>
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
