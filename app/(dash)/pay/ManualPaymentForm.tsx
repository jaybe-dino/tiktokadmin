"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manualPaymentAction } from "@/app/actions";

// 계좌이체·수기 결제 확인 기록 — 기존 게이트 액션(manualPaymentAction) 경유.
export default function ManualPaymentForm({ brands }: { brands: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [plan, setPlan] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [nextDue, setNextDue] = useState("");

  function run() {
    setMsg(null);
    if (!brandId) return setMsg({ ok: false, text: "브랜드를 선택하세요." });
    const amt = Number(amount);
    if (!amt || amt <= 0) return setMsg({ ok: false, text: "금액을 입력하세요." });
    if (!paidAt) return setMsg({ ok: false, text: "결제일을 입력하세요." });
    start(async () => {
      const r = await manualPaymentAction({
        brandId,
        plan: plan.trim() || "수기",
        amount: amt,
        paid_at: paidAt,
        next_due: nextDue || undefined,
      });
      if (r.ok) {
        setMsg({ ok: true, text: "수기 결제를 기록했습니다." });
        setPlan("");
        setAmount("");
        setPaidAt("");
        setNextDue("");
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error ?? "기록 실패" });
      }
    });
  }

  return (
    <div className="card mb-4">
      <div className="card-hd"><b>수기 결제 확인 기록</b></div>
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <select className="f" style={{ flex: "1 1 180px" }} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            {brands.length === 0 && <option value="">브랜드가 없습니다</option>}
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input
            className="f"
            style={{ flex: "1 1 140px" }}
            placeholder="플랜/항목 (예: 온보딩)"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <input
            className="f"
            style={{ flex: "1 1 120px" }}
            type="number"
            placeholder="금액(원)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label className="f" style={{ flex: "1 1 120px", padding: 0, border: "none", boxShadow: "none" }}>
            <span style={{ fontSize: 11, color: "var(--ink3)" }}>결제일</span>
            <input className="f" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </label>
          <label className="f" style={{ flex: "1 1 120px", padding: 0, border: "none", boxShadow: "none" }}>
            <span style={{ fontSize: 11, color: "var(--ink3)" }}>다음 결제일(선택)</span>
            <input className="f" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </label>
        </div>
        <button className="btn pri" style={{ marginTop: 10 }} disabled={pending} onClick={run}>
          {pending ? "처리 중…" : "수기 결제 확인 기록"}
        </button>
        {msg && (
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
