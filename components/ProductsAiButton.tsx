"use client";

import { useMemo, useState, useTransition } from "react";
import { certGuideAction } from "@/app/(dash)/products/actions";

type Row = Record<string, unknown>;

// 인증 필요서류 AI 가이드 — 실데이터에서 브랜드·제품·국가를 선택하면
// certGuideAction 이 제품/국가 맥락으로 필요 인증·서류 체크리스트 초안을 생성한다.
//   · 판정은 하지 않고 문구·요약·제안만. 저장 없음(검토용 초안 표시).
export default function ProductsAiButton({
  products,
  countries,
}: {
  products: Row[];
  countries: string[];
}) {
  const [productId, setProductId] = useState("");
  const [country, setCountry] = useState("");
  const [draft, setDraft] = useState("");
  const [info, setInfo] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, start] = useTransition();

  // 선택 가능한 제품(실데이터) — 브랜드·제품명 표기.
  const options = useMemo(
    () =>
      products
        .filter((p) => p.id)
        .map((p) => ({
          id: String(p.id),
          label: `${(p.brand_name as string) ?? ""} · ${(p.name_kr as string) ?? ""}`.trim(),
        })),
    [products],
  );

  function run() {
    setInfo(null);
    if (!productId) {
      setInfo({ text: "제품을 먼저 선택하세요.", bad: true });
      return;
    }
    start(async () => {
      const res = await certGuideAction({ productId, country });
      if (res.ok && res.draft) {
        setDraft(res.draft);
        setInfo({
          text: `${res.brandName ?? ""} · ${res.productName ?? ""}${
            res.country ? ` (${res.country})` : ""
          } — 등록된 항목 ${res.existingCount ?? 0}건 참고 · 검토 후 활용하세요`,
          bad: false,
        });
      } else {
        setInfo({ text: res.error || "생성 실패", bad: true });
      }
    });
  }

  return (
    <div className="aiw" style={{ display: "grid", gap: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} style={{ minWidth: 220 }}>
          <option value="">제품 선택 (실데이터)</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">국가 공통</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="button" className="btn" disabled={pending} onClick={run}>
          {pending ? "생성 중…" : "✨ AI 필요서류 가이드"}
        </button>
      </div>

      {info && (
        <div className="note" style={{ color: info.bad ? "#b91c1c" : "#7e22ce" }}>
          {info.text}
        </div>
      )}

      {draft && (
        <textarea
          className="f"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={12}
          style={{ width: "100%", fontFamily: "inherit", fontSize: 12, lineHeight: 1.6 }}
        />
      )}
      <div className="note">
        규정은 국가·품목별로 다를 수 있는 초안입니다. 판정이 아닌 참고용이며 검토 후 활용하세요.
      </div>
    </div>
  );
}
