"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { won } from "@/components/ScreenHeader";
import { remindAction } from "@/app/actions";

export interface SubRow {
  brand_id: string;
  brand_name: string;
  plan: string | null;
  amount: number | null;
  status: string;
  next_charge_at: string | null;
  failures: number | null;
}

function SubStatus({ status }: { status: string }) {
  if (status === "past_due") return <span className="chip chip-red">연체</span>;
  if (status === "subscribed" || status === "active") return <span className="chip chip-grn">유효</span>;
  if (status === "canceled") return <span className="chip">해지</span>;
  return <span className="chip chip-amb">{status}</span>;
}

// 구독(정기) 테이블 — 상태 필터(실제 목록 거름) + 연체 행 리마인더(remindAction 게이트 경유).
export default function SubsTable({ subs }: { subs: SubRow[] }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = useMemo(() => {
    return subs.filter((s) => {
      const okStatus =
        filter === "all"
          ? true
          : filter === "active"
            ? s.status === "subscribed" || s.status === "active"
            : s.status === filter;
      const okQ = q.trim() === "" || s.brand_name.toLowerCase().includes(q.trim().toLowerCase());
      return okStatus && okQ;
    });
  }, [subs, filter, q]);

  function remind(brandId: string, name: string) {
    setMsg(null);
    start(async () => {
      const r = await remindAction(brandId, "email");
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "실패" });
      else setMsg({ ok: true, text: r.sent ? `${name}: 리마인더 발송됨` : `${name}: 리마인더 초안 생성(미발송)` });
    });
  }

  return (
    <div className="card mb-4">
      <div className="card-hd" style={{ justifyContent: "space-between" }}>
        <b>구독 (정기)</b>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="f"
            style={{ width: 160 }}
            placeholder="브랜드 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="f" style={{ width: 120 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">전체 상태</option>
            <option value="active">유효</option>
            <option value="past_due">연체</option>
            <option value="canceled">해지</option>
          </select>
        </div>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>브랜드</th>
            <th>플랜</th>
            <th>금액</th>
            <th>상태</th>
            <th>다음 결제</th>
            <th>실패</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ color: "var(--ink3)" }}>구독 없음</td></tr>
          )}
          {rows.map((s, i) => (
            <tr key={i}>
              <td>
                <Link href={`/brand/${s.brand_id}`}><b>{s.brand_name}</b></Link>
              </td>
              <td>{s.plan ?? "—"}</td>
              <td>{s.amount != null ? won(s.amount) : "—"}</td>
              <td><SubStatus status={s.status} /></td>
              <td>{s.next_charge_at ? s.next_charge_at.slice(0, 10) : "—"}</td>
              <td style={(s.failures ?? 0) > 0 ? { color: "var(--danger)", fontWeight: 700 } : undefined}>
                {s.failures ?? 0}
              </td>
              <td style={{ textAlign: "right" }}>
                {s.status === "past_due" && (
                  <button
                    className="btn sm"
                    disabled={pending}
                    onClick={() => remind(s.brand_id, s.brand_name)}
                  >
                    리마인더
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && (
        <div
          className="note"
          style={{ margin: "0 16px 14px", color: msg.ok ? "var(--ok)" : "var(--danger)", fontWeight: 700 }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
