"use client";
// 제품 카테고리 2단 선택(대분류 → 소분류) — 값은 "스킨케어 > 크림" 형태 문자열 하나로 다룬다.
//   마케팅 제안서 생성/에디터, 운영대행 제안서 glovek 레퍼런스 조회 공용.
import { PRODUCT_CATEGORIES, joinCategory, splitCategory } from "@/lib/categories";

export default function CategoryPicker({
  value, onChange, compact = false,
}: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const { main, sub } = splitCategory(value);
  const subs = PRODUCT_CATEGORIES.find((c) => c.main === main)?.subs ?? [];
  const w = compact ? 120 : 150;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select className="f" value={main} style={{ width: w }}
        onChange={(e) => onChange(joinCategory(e.target.value))}>
        <option value="">대분류 선택</option>
        {PRODUCT_CATEGORIES.map((c) => <option key={c.main} value={c.main}>{c.main}</option>)}
      </select>
      <select className="f" value={sub} style={{ width: w }} disabled={!main}
        onChange={(e) => onChange(joinCategory(main, e.target.value))}>
        <option value="">{main ? "소분류(전체)" : "소분류"}</option>
        {subs.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </span>
  );
}
