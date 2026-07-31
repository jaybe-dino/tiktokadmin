"use client";
import { useState } from "react";

export default function DisputeButton({ settlementId }: { settlementId: string }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function dispute() {
    setBusy(true);
    const res = await fetch("/api/portal/dispute", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ settlement_id: settlementId }),
    });
    if (res.ok) setDone(true);
    setBusy(false);
  }
  if (done) return <p style={{ fontSize: 13, color: "#1a8a3f", marginTop: 8 }}>이의 제기가 접수되었습니다.</p>;
  return (
    <button onClick={dispute} disabled={busy}
      style={{ marginTop: 10, background: "#fff", border: "1px solid #e84a80", color: "#e84a80", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}>
      {busy ? "접수 중…" : "이의 제기"}
    </button>
  );
}
