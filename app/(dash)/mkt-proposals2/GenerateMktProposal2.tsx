"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateMktProposal2Action } from "./actions";
import type { SurveyEligibleBrand } from "@/lib/mkt-proposal2";

export default function GenerateMktProposal2({ brands }: { brands: SurveyEligibleBrand[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [brandId, setBrandId] = useState(brands[0]?.brand_id ?? "");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ id: string; warnings: string[] } | null>(null);

  function generate() {
    setErr(""); setResult(null);
    start(async () => {
      const r = await generateMktProposal2Action(brandId);
      if (r.ok && r.id) setResult({ id: r.id, warnings: r.warnings ?? [] });
      else setErr(r.error ?? "생성 실패");
    });
  }

  return (
    <div className="card">
      <div className="bd" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <label className="f">브랜드 (설문 응답 보유)</label>
          <select className="f" value={brandId} onChange={(e) => { setBrandId(e.target.value); setResult(null); }} style={{ minWidth: 240 }}>
            {brands.length === 0 && <option value="">설문 응답 있는 브랜드 없음</option>}
            {brands.map((b) => (
              <option key={b.brand_id} value={b.brand_id}>
                {b.brand_name}{b.proposal_count > 0 ? ` · 기존 ${b.proposal_count}건` : ""}
              </option>
            ))}
          </select>
        </div>
        <button className="btn pri" disabled={pending || !brandId} onClick={generate}>{pending ? "자동생성 중…" : "🤖 설문으로 자동생성"}</button>
        {err && <span className="chip red" style={{ fontSize: 11 }}>{err}</span>}
        <span style={{ marginLeft: "auto", color: "var(--ink3)", fontSize: 11.5 }}>제목·제품·예산·국가 자동 프리필 → 에디터에서 텍스트만 다듬기</span>
      </div>

      {result && (
        <div style={{ margin: "0 14px 14px", padding: 12, background: result.warnings.length ? "#fff9db" : "#eafaf1", border: "1px solid var(--line)", borderRadius: 10 }}>
          {result.warnings.length > 0 ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>⚠️ 자동생성은 완료됐지만 확인이 필요합니다</div>
              <ul style={{ margin: "0 0 10px 18px", fontSize: 12.5, color: "#92400e", lineHeight: 1.6 }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0b7a52", marginBottom: 6 }}>✅ 자동생성 완료 — 확인 항목 없음</div>
          )}
          <button className="btn sm pri" onClick={() => router.push(`/mkt-proposals/${result.id}`)}>편집하러 가기 →</button>
        </div>
      )}
    </div>
  );
}
