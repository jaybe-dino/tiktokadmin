"use client";
// 브랜드별 신청 제품 관리(어드민) — 브랜드 선택 → 온보딩 신청서/제품포털에서 등록한 제품을
//   개별 열람하고 승인/반려한다. 반려 사유는 브랜드 제품포털(/apply/products)에 그대로 표시된다.
import { useState, useTransition } from "react";
import { getBrandOnbProductsAction, setOnbProductApprovalAction, type BrandOnbProducts } from "@/app/(dash)/products/actions";

type Products = NonNullable<BrandOnbProducts["products"]>;

const AP: Record<string, { label: string; cls: string }> = {
  pending: { label: "승인 대기", cls: "cc-warn" },
  approved: { label: "승인됨", cls: "cc-ok" },
  rejected: { label: "반려", cls: "cc-no" },
};
const CERT: Record<string, string> = { none: "없음", preparing: "준비중", ready: "완료" };
const isUrl = (v: string) => /^(https?:\/\/|\/api\/)/.test(v);

export default function OnbProductAdmin({ brands }: { brands: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [brandId, setBrandId] = useState("");
  const [data, setData] = useState<Products | null>(null);
  const [noApp, setNoApp] = useState(false);
  const [msg, setMsg] = useState("");
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});

  function load(id: string) {
    setBrandId(id); setData(null); setNoApp(false); setMsg("");
    if (!id) return;
    start(async () => {
      const r = await getBrandOnbProductsAction(id);
      if (!r.ok) { setMsg(r.error ?? "조회 실패"); return; }
      if (!r.appId) { setNoApp(true); setData([]); return; }
      setData(r.products ?? []);
    });
  }
  function decide(pid: string, status: "approved" | "rejected" | "pending") {
    setMsg("");
    start(async () => {
      const r = await setOnbProductApprovalAction(pid, status, rejectNote[pid] ?? "");
      if (!r.ok) { setMsg(r.error ?? "처리 실패"); return; }
      load(brandId); // 최신 상태 재조회
    });
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="hd">
        <b>🧾 브랜드별 신청 제품 관리</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          브랜드사가 온보딩 신청서·제품 포털(/apply/products)에서 등록한 제품 — 개별 열람·승인/반려
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="f" value={brandId} onChange={(e) => load(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">브랜드 선택…</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {pending && <span style={{ fontSize: 12, color: "var(--ink3)" }}>불러오는 중…</span>}
          {msg && <span className="chip red" style={{ fontSize: 11 }}>{msg}</span>}
        </div>

        {noApp && <div className="note">이 브랜드는 아직 온보딩 신청서(제품 등록)가 없습니다.</div>}
        {data && data.length === 0 && !noApp && brandId && !pending && (
          <div className="note">등록된 제품이 없습니다 — 브랜드가 제품 포털에서 추가하면 여기에 표시됩니다.</div>
        )}

        {data?.map((p) => {
          const ap = AP[p.approval_status ?? "pending"] ?? AP.pending;
          return (
            <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 14 }}>{p.name || "(제품명 없음)"}</b>
                {p.category && <span className="chip" style={{ fontSize: 11 }}>{p.category}</span>}
                {p.sku && <span style={{ fontSize: 11, color: "var(--ink3)" }}>SKU {p.sku}</span>}
                <span className={`cellchip ${ap.cls}`} style={{ marginLeft: "auto" }}>{ap.label}</span>
              </div>
              {p.description_kr && <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>{p.description_kr}</div>}
              <div style={{ fontSize: 12, marginTop: 4 }}>
                영문 라벨 사진:{" "}
                {p.label_photo_url
                  ? <a href={p.label_photo_url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>📷 보기 ↗</a>
                  : <span style={{ color: "#c92a2a" }}>미등록</span>}
              </div>
              {p.approval_status === "rejected" && p.approval_note && (
                <div style={{ fontSize: 12, color: "#c92a2a", marginTop: 4 }}>반려 사유: {p.approval_note}</div>
              )}
              {p.countries.length > 0 && (
                <table className="t" style={{ marginTop: 8, fontSize: 12 }}>
                  <thead><tr><th>국가</th><th>단가</th><th>인증</th><th>인증 첨부</th><th>상세페이지(한글)</th><th>번역본</th></tr></thead>
                  <tbody>
                    {p.countries.map((c) => (
                      <tr key={c.id}>
                        <td><b>{c.country_code}</b></td>
                        <td>{c.unit_price ? `${c.unit_price} ${c.currency}` : "—"}</td>
                        <td>{CERT[c.cert_status] ?? c.cert_status}</td>
                        <td>{c.cert_file_url ? <a href={c.cert_file_url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>파일 ↗</a> : "—"}</td>
                        <td style={{ maxWidth: 260, whiteSpace: "pre-wrap" }}>{c.detail_page_kr ? (isUrl(c.detail_page_kr) ? <a href={c.detail_page_kr} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>링크 ↗</a> : c.detail_page_kr.slice(0, 120)) : "—"}</td>
                        <td>{c.detail_page_translated ? (isUrl(c.detail_page_translated) ? <a href={c.detail_page_translated} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>번역본 ↗</a> : c.detail_page_translated.slice(0, 60)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                {p.approval_status !== "approved" && (
                  <button className="btn sm pri" disabled={pending} onClick={() => decide(p.id, "approved")}>✅ 승인</button>
                )}
                {p.approval_status === "approved" && (
                  <button className="btn sm" disabled={pending} onClick={() => decide(p.id, "pending")} style={{ color: "#c25400" }}>승인 취소(대기로)</button>
                )}
                <input className="f" placeholder="반려 사유(브랜드에 표시됨)" value={rejectNote[p.id] ?? ""}
                  onChange={(e) => setRejectNote((s) => ({ ...s, [p.id]: e.target.value }))}
                  style={{ flex: 1, minWidth: 180, fontSize: 12 }} />
                <button className="btn sm" disabled={pending} onClick={() => decide(p.id, "rejected")} style={{ color: "#e03131" }}>⛔ 반려</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
