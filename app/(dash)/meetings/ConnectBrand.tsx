"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectMeetingBrandAction } from "./actions";

// 매칭 필요 미팅 → 브랜드 수동 연결(브랜드 선택 + 연결 실행).
export default function ConnectBrand({
  meetingId,
  brands,
}: {
  meetingId: string;
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [brandId, setBrandId] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function connect() {
    if (!brandId) {
      setErr("브랜드를 선택하세요.");
      return;
    }
    setErr("");
    start(async () => {
      const r = await connectMeetingBrandAction(meetingId, brandId);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "연결 실패");
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
      {err && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--danger)" }}>{err}</span>}
      <select
        value={brandId}
        onChange={(e) => setBrandId(e.target.value)}
        disabled={pending}
        style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "4px 8px", fontSize: 11, background: "#fff", fontFamily: "inherit", color: "var(--ink2)", maxWidth: 130 }}
      >
        <option value="">브랜드 선택…</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <button className="btn sm pri" disabled={pending} onClick={connect}>
        {pending ? "연결 중…" : "브랜드 연결"}
      </button>
    </span>
  );
}
