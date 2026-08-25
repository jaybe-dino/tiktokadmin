"use client";
// 브랜드사 제품 관리 포털 — 온보딩 신청서(Step4)와 동일한 제품 카드 UI 재사용.
//   신청서 제출 상태와 무관하게 항상 편집 가능. 제품별 승인 상태(대기/승인/반려) 표시.
//   승인된 제품을 수정하면 자동으로 '승인 대기'로 되돌아간다(재검토).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addProductAction, deleteProductAction } from "../actions";
import { ProductCard, Card, Empty, type Country, type Product, type ProductCountry } from "../ApplyForm";
import ImageTranslate from "@/components/ImageTranslate";

const APPROVAL: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: "⏳ 승인 대기", bg: "#fff7e0", fg: "#a16207" },
  approved: { label: "✅ 승인됨", bg: "#eafaf1", fg: "#0b7a52" },
  rejected: { label: "⛔ 반려", bg: "#fdecec", fg: "#c92a2a" },
};

type ProductRow = Product & { approval_status?: string; approval_note?: string };

export default function ProductsPortal({ email, countries, products, productCountries }: {
  email: string;
  countries: Country[];
  products: ProductRow[];
  productCountries: Record<string, ProductCountry[]>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({ name: "", category: "", sku: "" });
  const [toast, setToast] = useState("");
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };

  async function add() {
    if (!draft.name.trim()) { flash("제품명을 입력하세요."); return; }
    const r = await addProductAction(draft);
    if (r.ok) { setDraft({ name: "", category: "", sku: "" }); router.refresh(); flash("제품이 추가되었습니다. 저장 후 승인 검토가 진행됩니다."); }
    else flash(r.error ?? "추가 실패");
  }
  async function del(id: string) {
    if (!confirm("이 제품을 삭제할까요?")) return;
    const r = await deleteProductAction(id);
    if (r.ok) { router.refresh(); flash("삭제되었습니다."); }
  }
  async function logout() { await fetch("/api/apply/logout", { method: "POST" }); router.replace("/apply/login"); router.refresh(); }

  return (
    <div style={{ paddingBottom: 60 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 4px 6px", flexWrap: "wrap" }}>
        <span style={{ color: "#12b886", fontWeight: 800, fontSize: 15 }}>TikTok Shop 제품 관리</span>
        <span style={{ color: "#8b93a1", fontSize: 13, marginLeft: "auto" }}>{email}</span>
        <a href="/apply" style={{ color: "#8b93a1", border: "1px solid #d5dae1", borderRadius: 8, padding: "5px 10px", fontSize: 12, textDecoration: "none" }}>온보딩 신청서 →</a>
        <button onClick={logout} style={{ background: "transparent", color: "#8b93a1", border: "1px solid #d5dae1", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>로그아웃</button>
      </header>
      <p style={{ color: "#8b93a1", fontSize: 12.5, margin: "0 4px 16px" }}>
        판매할 제품을 등록·수정하면 담당자가 검토 후 승인합니다. 승인된 제품을 수정하면 다시 승인 대기로 전환됩니다.
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="➕ 제품 추가">
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <label style={lbl}>제품명 *<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inp} /></label>
            <label style={lbl}>카테고리<input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={inp} /></label>
            <label style={lbl}>SKU<input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} style={inp} /></label>
            <button onClick={add} style={{ background: "#12b886", color: "#fff", border: 0, borderRadius: 9, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>추가</button>
          </div>
        </Card>

        {products.length === 0 ? (
          <Empty>등록된 제품이 없습니다. 위에서 제품을 추가해주세요.</Empty>
        ) : products.map((p, idx) => {
          const ap = APPROVAL[p.approval_status ?? "pending"] ?? APPROVAL.pending;
          return (
            <div key={p.id}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: -6, position: "relative", zIndex: 1, paddingLeft: 4 }}>
                <span style={{ background: ap.bg, color: ap.fg, borderRadius: 8, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{ap.label}</span>
                {p.approval_status === "rejected" && p.approval_note && (
                  <span style={{ fontSize: 12, color: "#c92a2a" }}>사유: {p.approval_note}</span>
                )}
              </div>
              <ProductCard
                idx={idx} p={p} disabled={false} countries={countries}
                rows={productCountries[p.id] ?? []}
                onChange={() => router.refresh()} flash={flash} onDelete={() => del(p.id)}
              />
            </div>
          );
        })}

        <Card title="🌐 상세페이지 이미지 번역"
          desc="상세페이지 이미지 속 한글을 영어·베트남어·태국어로 번역한 새 이미지를 만들어 드립니다. 레이아웃·디자인은 유지되며 번역본은 자동 저장됩니다.">
          <ImageTranslate endpoint="/api/apply/translate-image" compact />
        </Card>
      </div>

      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: 13, zIndex: 50 }}>{toast}</div>}
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12, color: "#666", fontWeight: 600, display: "grid", gap: 4 };
const inp: React.CSSProperties = { width: "100%", background: "#fff", border: "1px solid #d5dae1", borderRadius: 9, padding: "10px 12px", color: "#111", fontSize: 14, boxSizing: "border-box" };
