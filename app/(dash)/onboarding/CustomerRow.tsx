"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setOnbCustomerActiveAction, setOnbCustomerBrandAction, forceApproveCustomerAction, deleteOnbCustomerAction } from "./actions";
import { kstDate } from "@/lib/time";

interface Row { id: string; email: string; brand_id: string | null; note: string; active: boolean; last_login_at: string | null; app_id: string | null; app_status: string | null; submitted_steps: number; countries: string | null }

const STATUS: Record<string, [string, string]> = {
  draft: ["작성중", "#4dabf7"], submitted: ["검토대기", "#f0a02c"],
  approved: ["승인완료", "#12b886"], rejected: ["반려", "#e03131"],
};

export default function CustomerRow({ c, brands }: { c: Row; brands: { id: string; brand_name: string }[] }) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(c.brand_id ?? "");
  const [active, setActive] = useState(c.active);
  const [busy, setBusy] = useState(false);
  const st = c.app_status ? STATUS[c.app_status] ?? [c.app_status, "#888"] : ["미시작", "#999"];

  async function changeBrand(v: string) {
    setBrandId(v); setBusy(true);
    await setOnbCustomerBrandAction(c.id, v || null); setBusy(false);
  }
  async function toggle() {
    setBusy(true); const next = !active; setActive(next);
    await setOnbCustomerActiveAction(c.id, next); setBusy(false);
  }
  async function forceApprove() {
    if (!brandId) { alert("먼저 '연결 브랜드'를 지정하세요 — 강제 승인 시 해당 브랜드 원장에 매핑됩니다."); return; }
    if (!confirm(`${c.email} 신청서를 고객 입력 여부와 무관하게 강제 승인하고 브랜드 원장에 매핑합니다.\n진행할까요?`)) return;
    setBusy(true);
    const r = await forceApproveCustomerAction(c.id);
    setBusy(false);
    if (r.ok) { alert(`강제 승인 완료 — 제품 ${r.mappedProducts ?? 0} · 국가 ${r.mappedCountries ?? 0} 매핑됨`); router.refresh(); }
    else alert(r.error ?? "승인 실패");
  }
  async function remove() {
    if (!confirm(`${c.email} 계정과 작성된 신청서·서류를 완전히 삭제합니다.\n되돌릴 수 없습니다. 진행할까요?`)) return;
    setBusy(true);
    const r = await deleteOnbCustomerAction(c.id);
    setBusy(false);
    if (r.ok) router.refresh();
    else alert(r.error ?? "삭제 실패");
  }

  return (
    <tr style={{ opacity: active ? 1 : 0.5 }}>
      <td style={td}>
        <div style={{ fontWeight: 600 }}>{c.email}</div>
        {c.note && <div style={{ fontSize: 11, color: "var(--ink2)" }}>{c.note}</div>}
      </td>
      <td style={td}>
        <select value={brandId} disabled={busy} onChange={(e) => changeBrand(e.target.value)}
          style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "5px 8px", fontSize: 12, background: "var(--bg)", maxWidth: 160 }}>
          <option value="">— 미연결 —</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
        </select>
      </td>
      <td style={td}>
        {c.countries
          ? c.countries.split(", ").map((cc) => (
              <span key={cc} className="chip" style={{ fontSize: 11, marginRight: 4, background: "#eef2ff", color: "#3730a3" }}>{cc}</span>
            ))
          : <span style={{ fontSize: 12, color: "var(--ink3)" }}>—</span>}
      </td>
      <td style={td}><span style={{ color: st[1], fontWeight: 600 }}>{st[0]}</span></td>
      <td style={td}>{c.submitted_steps}/4</td>
      <td style={{ ...td, fontSize: 12, color: "var(--ink2)" }}>{c.last_login_at ? kstDate(c.last_login_at) : "—"}</td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        <Link className="btn sm" href={`/onboarding/${c.id}`}>검토 →</Link>
        {c.app_status !== "approved" && (
          <button className="btn sm" disabled={busy} onClick={forceApprove} style={{ marginLeft: 6, color: "#0b7a52", fontWeight: 700 }} title="입력 여부와 무관하게 강제 승인 + 브랜드 원장 매핑">강제승인</button>
        )}
        <button className="btn sm" disabled={busy} onClick={toggle} style={{ marginLeft: 6 }}>{active ? "비활성" : "활성"}</button>
        <button className="btn sm" disabled={busy} onClick={remove} style={{ marginLeft: 6, color: "#e03131" }} title="계정·신청서 완전 삭제">삭제</button>
      </td>
    </tr>
  );
}

const td: React.CSSProperties = { padding: "10px 14px", borderBottom: "1px solid var(--line)", verticalAlign: "middle" };
