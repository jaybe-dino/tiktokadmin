"use client";

// 설정 — 브랜드 카테고리 관리(추가/삭제). 브랜드360 회사정보 카테고리 셀렉트에 반영.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBrandCategoryAction, removeBrandCategoryAction } from "@/app/(dash)/settings/category-actions";
import type { BrandCategory } from "@/lib/brand-categories";

export default function BrandCategoryConfig({ categories, canEdit }: { categories: BrandCategory[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  return (
    <div className="card">
      <div className="card-hd">
        <b>브랜드 카테고리</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>브랜드360 카테고리 선택지</span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {categories.length === 0 && <span className="note" style={{ margin: 0 }}>등록된 카테고리가 없습니다 — 기본값(스킨케어·색조·더마)이 사용됩니다.</span>}
          {categories.map((c) => (
            <span key={c.id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {c.name}
              {canEdit && (
                <button
                  style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink3)", fontSize: 12 }}
                  title="삭제"
                  disabled={pending}
                  onClick={() => start(async () => { await removeBrandCategoryAction(c.id); router.refresh(); })}
                >✕</button>
              )}
            </span>
          ))}
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { e.preventDefault(); add(); } }}
              placeholder="카테고리 추가 (예: 헤어·바디)"
            />
            <button className="btn btn-sm pri" disabled={pending || !name.trim()} onClick={add}>+ 추가</button>
          </div>
        )}
        {msg && <div className="note">{msg}</div>}
      </div>
    </div>
  );

  function add() {
    setMsg("");
    start(async () => {
      const r = await addBrandCategoryAction(name);
      if (r.ok) { setName(""); router.refresh(); } else setMsg(r.error ?? "실패");
    });
  }
}
