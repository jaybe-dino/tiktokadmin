"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProposalDocAction } from "./actions";

// 새 제안서 생성 — 브랜드 선택 시 이름·로고·트랙·제품을 원장에서 프리필.
export default function NewProposalDoc({ brands }: { brands: { id: string; brand_name: string }[] }) {
  const router = useRouter();
  const [brandId, setBrandId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true); setError("");
    const r = await createProposalDocAction(brandId || null);
    setBusy(false);
    if (r.ok && r.id) router.push(`/proposal-docs/${r.id}`);
    else setError(r.error ?? "생성 실패");
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <b>새 운영 제안서</b>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--ink2)", display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>
          브랜드 (선택 시 이름·로고·제품 자동 반영)
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "var(--bg)", width: 260 }}>
            <option value="">— 브랜드 없이 빈 제안서 —</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
          </select>
        </label>
        <button className="btn primary" disabled={busy} onClick={create} style={{ height: 38, opacity: busy ? 0.6 : 1 }}>
          {busy ? "생성 중…" : "생성 → 편집"}
        </button>
      </div>
      {error && <div style={{ color: "#e03131", fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
