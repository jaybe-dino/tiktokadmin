"use client";
import { useState } from "react";
import Link from "next/link";
import { setOnbCustomerActiveAction, setOnbCustomerBrandAction } from "./actions";

interface Row { id: string; email: string; brand_id: string | null; note: string; active: boolean; last_login_at: string | null; app_id: string | null; app_status: string | null; submitted_steps: number }

const STATUS: Record<string, [string, string]> = {
  draft: ["작성중", "#4dabf7"], submitted: ["검토대기", "#f0a02c"],
  approved: ["승인완료", "#12b886"], rejected: ["반려", "#e03131"],
};

export default function CustomerRow({ c, brands }: { c: Row; brands: { id: string; brand_name: string }[] }) {
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
      <td style={td}><span style={{ color: st[1], fontWeight: 600 }}>{st[0]}</span></td>
      <td style={td}>{c.submitted_steps}/4</td>
      <td style={{ ...td, fontSize: 12, color: "var(--ink2)" }}>{c.last_login_at ? new Date(c.last_login_at).toLocaleDateString("ko-KR") : "—"}</td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        {c.app_id && <Link className="btn sm" href={`/onboarding/${c.id}`}>검토 →</Link>}
        <button className="btn sm" disabled={busy} onClick={toggle} style={{ marginLeft: 6 }}>{active ? "비활성" : "활성"}</button>
      </td>
    </tr>
  );
}

const td: React.CSSProperties = { padding: "10px 14px", borderBottom: "1px solid var(--line)", verticalAlign: "middle" };
