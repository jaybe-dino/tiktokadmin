"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMktProposalDocAction } from "./actions";

export default function NewMktProposal({ brands }: { brands: { id: string; brand_name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [msg, setMsg] = useState("");

  function create() {
    setMsg("");
    start(async () => {
      const r = await createMktProposalDocAction(brandId);
      if (r.ok && r.id) router.push(`/mkt-proposals/${r.id}`);
      else setMsg(r.error ?? "생성 실패");
    });
  }

  return (
    <div className="card">
      <div className="bd" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <label className="f">브랜드</label>
          <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ minWidth: 200 }}>
            {brands.length === 0 && <option value="">브랜드 없음</option>}
            {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
          </select>
        </div>
        <button className="btn pri" disabled={pending || !brandId} onClick={create}>{pending ? "생성 중…" : "+ 마케팅 제안서 생성"}</button>
        {msg && <span className="chip red" style={{ fontSize: 11 }}>{msg}</span>}
        <span style={{ marginLeft: "auto", color: "var(--ink3)", fontSize: 11.5 }}>브랜드 선택 → 제품·예산 프리필 → 에디터에서 완성</span>
      </div>
    </div>
  );
}
