"use client";

// v3.1 제품·인증·재고 탭 — 제품 마스터(+제품) · 국가×제품 인증 매트릭스(+인증 등록/수정) · 초기 재고 투입.
// products_master · product_certs · inventory_intakes 실데이터.
// 출처 원칙(PLAN 8절): apply/glovek 유래 행은 출처를 표시하되 원본은 읽기전용 —
// 어드민에서 저장하는 값은 전부 어드민 원장 테이블(products_master·product_certs)이며 보정값이 우선한다.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProductAction } from "@/app/actions";
import { upsertCertFullAction } from "@/app/(dash)/brand360/actions";
import TabJumpButton from "@/components/TabJumpButton";
import type { InventoryIntake, Product, ProductCert } from "@/lib/repo/card";

const CERT_STATUS: Record<string, { label: string; cls: string }> = {
  ready: { label: "완료", cls: "cc-ok" },
  submitted: { label: "심사", cls: "cc-warn" },
  preparing: { label: "진행", cls: "cc-ing" },
  rejected: { label: "반려", cls: "cc-exp" },
  expired: { label: "만료", cls: "cc-exp" },
  none: { label: "—", cls: "cc-no" },
};
const COUNTRY_FLAG: Record<string, string> = { US: "🇺🇸", VN: "🇻🇳", TH: "🇹🇭", MY: "🇲🇾", SG: "🇸🇬", PH: "🇵🇭" };
const INV_STATUS: Record<string, string> = { planned: "계획", shipped: "발송", arrived: "도착", stocked: "입고", issue: "이슈" };
// products_master.source — apply_step4|glovek_onb|manual (원본 읽기전용, 어드민 보정값 우선)
const SOURCE_CHIP: Record<string, { label: string; cls: string; title: string }> = {
  apply_step4: { label: "apply", cls: "cc-warn", title: "apply 스텝4 유래 — 원본 읽기전용, 어드민 보정값 우선" },
  glovek_onb: { label: "glovek", cls: "cc-warn", title: "glovek 온보딩 유래 — 원본 읽기전용, 어드민 보정값 우선" },
  manual: { label: "어드민", cls: "cc-no", title: "어드민 직접 입력" },
};

/** 인증 등록/수정 폼 프리필 값 — 매트릭스 셀 클릭 시 채워진다. */
type CertDraft = {
  product_id: string; country: string; cert_type: string; status: string;
  cert_number: string; expires_at: string; note: string;
};

export default function Brand360Products({ brandId, products, certs, inventory, setupStage }: {
  brandId: string;
  products: Product[];
  certs: (ProductCert & { product_name: string })[];
  inventory: (InventoryIntake & { product_name: string | null })[];
  setupStage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openProd, setOpenProd] = useState(false);
  const [openCert, setOpenCert] = useState(false);
  const [certDraft, setCertDraft] = useState<CertDraft | null>(null);
  const [msg, setMsg] = useState("");

  // /products 등 외부 화면에서 "#tab=pd" 로 진입하면 제품 탭으로 전환.
  // 탭 전환 이벤트 리스너(Brand360Tabs — 부모)는 자식 이펙트 이후에 등록되므로 한 틱 늦춰 발화.
  useEffect(() => {
    if (window.location.hash !== "#tab=pd") return;
    const t = window.setTimeout(() => window.dispatchEvent(new CustomEvent("b360:tab", { detail: "pd" })), 0);
    return () => window.clearTimeout(t);
  }, []);

  // 매트릭스 열: 인증 데이터에 존재하는 국가 + 기본 진출국(제품이 있으면 항상 편집 가능하게).
  const matrixCountries = [...new Set([...certs.map((c) => c.country), ...(products.length > 0 ? Object.keys(COUNTRY_FLAG) : [])])].sort();
  const bestCert = (productId: string, country: string) => {
    const rows = certs.filter((c) => c.product_id === productId && c.country === country);
    if (rows.length === 0) return null;
    const order = ["ready", "submitted", "preparing", "rejected", "expired", "none"];
    return rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
  };

  /** 셀 클릭 → 해당 인증을 폼에 프리필(없으면 제품·국가만 채운 신규). */
  const editCell = (productId: string, country: string) => {
    const cur = bestCert(productId, country);
    setCertDraft(cur
      ? {
          product_id: cur.product_id, country: cur.country, cert_type: cur.cert_type,
          status: cur.status, cert_number: cur.cert_number ?? "",
          expires_at: cur.expires_at ? cur.expires_at.slice(0, 10) : "", note: cur.note ?? "",
        }
      : { product_id: productId, country, cert_type: "", status: "preparing", cert_number: "", expires_at: "", note: "" });
    setOpenCert(true);
  };

  return (
    <div className="grid g2" style={{ gap: 14 }}>
      {/* ── 제품 마스터 ── */}
      <div className="card">
        <div className="hd">
          <b>제품 마스터 {products.length}종</b>
          <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setOpenProd((o) => !o)}>
            {openProd ? "닫기" : "+ 제품"}
          </button>
        </div>
        <div className="bd">
          {openProd && (
            <form
              style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                start(async () => {
                  const r = await addProductAction({
                    brand_id: brandId,
                    name_kr: String(f.get("name_kr") ?? ""),
                    name_en: String(f.get("name_en") ?? "") || undefined,
                    category: String(f.get("category") ?? "") || undefined,
                    sku: String(f.get("sku") ?? "") || undefined,
                    price_band: String(f.get("price_band") ?? "") || undefined,
                  });
                  setMsg(r.ok ? "제품 추가됨" : r.error ?? "실패");
                  if (r.ok) { form.reset(); setOpenProd(false); }
                  router.refresh();
                });
              }}
            >
              <input name="name_kr" className="f" style={{ flex: 1, minWidth: 130 }} placeholder="제품명 (국문) *" required />
              <input name="name_en" className="f" style={{ flex: 1, minWidth: 120 }} placeholder="영문명" />
              <input name="category" className="f" style={{ width: 100 }} placeholder="카테고리" />
              <input name="sku" className="f" style={{ width: 90 }} placeholder="SKU" />
              <input name="price_band" className="f" style={{ width: 90 }} placeholder="판매가" />
              <button className="btn sm pri" disabled={pending} type="submit">추가</button>
            </form>
          )}
          {products.length === 0 ? (
            <p className="note">등록된 제품이 없습니다 — apply 스텝4·수기 입력으로 제품 마스터가 채워집니다.</p>
          ) : (
            <table className="t">
              <thead>
                <tr><th>제품</th><th>카테고리</th><th>판매가</th><th>인증</th><th>출처</th></tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const pc = certs.filter((c) => c.product_id === p.id);
                  const ok = pc.filter((c) => c.status === "ready").length;
                  const src = SOURCE_CHIP[p.source] ?? SOURCE_CHIP.manual;
                  return (
                    <tr key={p.id}>
                      <td>
                        <b>{p.name_kr}</b>
                        <span className="sub">{[p.name_en, p.sku && `SKU ${p.sku}`].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td>{p.category || "—"}</td>
                      <td>{p.price_band || "—"}</td>
                      <td>
                        {pc.length === 0 ? (
                          <span className="cellchip cc-no">—</span>
                        ) : (
                          <span className={`cellchip ${ok > 0 ? "cc-ok" : "cc-warn"}`}>{ok}/{pc.length} 완료</span>
                        )}
                      </td>
                      <td><span className={`cellchip ${src.cls}`} title={src.title}>{src.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {products.some((p) => p.source !== "manual") && (
            <div className="note" style={{ marginTop: 8 }}>
              apply·glovek 유래 행은 원본 읽기전용 — 수정하면 어드민 원장 보정값이 우선 적용됩니다.
            </div>
          )}
          {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        {/* ── 국가 × 제품 인증 매트릭스 ── */}
        <div className="card">
          <div className="hd">
            <b>국가 × 제품 인증 매트릭스</b>
            <div className="rt">
              <button
                className="btn sm"
                onClick={() => { setCertDraft(null); setOpenCert((o) => !o); }}
              >
                {openCert ? "닫기" : "+ 인증 등록·수정"}
              </button>
            </div>
          </div>
          <div className="bd">
            {openCert && (
              <form
                // certDraft(셀 클릭 프리필)마다 key 를 바꿔 defaultValue 를 다시 적용.
                key={certDraft ? `${certDraft.product_id}:${certDraft.country}:${certDraft.cert_type}` : "new"}
                style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const form = e.currentTarget;
                  start(async () => {
                    const r = await upsertCertFullAction(brandId, {
                      product_id: String(f.get("product_id") ?? ""),
                      country: String(f.get("country") ?? "US"),
                      cert_type: String(f.get("cert_type") ?? ""),
                      status: String(f.get("status") ?? "preparing"),
                      cert_number: String(f.get("cert_number") ?? "") || undefined,
                      expires_at: String(f.get("expires_at") ?? "") || null,
                      note: String(f.get("note") ?? "") || undefined,
                    });
                    setMsg(r.ok ? "인증 저장됨" : r.error ?? "실패");
                    if (r.ok) { form.reset(); setOpenCert(false); setCertDraft(null); }
                    router.refresh();
                  });
                }}
              >
                <select name="product_id" className="f" style={{ flex: 1, minWidth: 130 }} defaultValue={certDraft?.product_id ?? ""} required>
                  <option value="">제품 선택</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name_kr}</option>)}
                </select>
                <select name="country" className="f" style={{ width: 80 }} defaultValue={certDraft?.country ?? "US"}>
                  {Object.keys(COUNTRY_FLAG).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input name="cert_type" className="f" style={{ width: 110 }} placeholder="인증종류(FDA…) *" defaultValue={certDraft?.cert_type ?? ""} required />
                <select name="status" className="f" style={{ width: 90 }} defaultValue={certDraft?.status ?? "preparing"}>
                  {Object.entries(CERT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <input name="cert_number" className="f" style={{ width: 110 }} placeholder="인증번호" defaultValue={certDraft?.cert_number ?? ""} />
                <input name="expires_at" className="f" style={{ width: 130 }} type="date" title="만료일" defaultValue={certDraft?.expires_at ?? ""} />
                <input name="note" className="f" style={{ flex: 1, minWidth: 180 }} placeholder="서류 링크(드라이브 URL)·메모" defaultValue={certDraft?.note ?? ""} />
                <button className="btn sm pri" disabled={pending} type="submit">저장</button>
              </form>
            )}
            {products.length === 0 || matrixCountries.length === 0 ? (
              <p className="note">인증 데이터가 없습니다 — 제품 등록 후 [+ 인증 등록·수정]으로 국가별 인증을 기록하세요.</p>
            ) : (
              <table className="t matrix">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>제품</th>
                    {matrixCountries.map((c) => <th key={c}>{COUNTRY_FLAG[c] ?? ""}{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td style={{ textAlign: "left" }}>{p.name_kr}</td>
                      {matrixCountries.map((c) => {
                        const cert = bestCert(p.id, c);
                        const st = cert ? CERT_STATUS[cert.status] ?? { label: cert.status, cls: "cc-no" } : { label: "—", cls: "cc-no" };
                        const tip = cert
                          ? `${cert.cert_type}${cert.expires_at ? ` · 만료 ${cert.expires_at.slice(0, 10)}` : ""}${cert.note ? ` · ${cert.note}` : ""} — 클릭해 수정`
                          : "클릭해 인증 등록";
                        return (
                          <td key={c}>
                            <button
                              type="button"
                              className={`cellchip ${st.cls}`}
                              style={{ cursor: "pointer", border: "none" }}
                              title={tip}
                              onClick={() => editCell(p.id, c)}
                            >
                              {st.label}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="note" style={{ marginTop: 8 }}>
              셀 클릭 → 등록/수정 · 인증 만료 30일 전 자동 알림 · 갱신 작업 자동 생성
            </div>
          </div>
        </div>

        {/* ── 초기 재고 투입 ── */}
        <div className="card">
          <div className="hd">
            <b>초기 재고 투입</b>
            <div className="rt">
              {/* 물류계약 등록·갱신은 서류·물류 탭(logistics_contracts 원장)에서 — 탭 점프 */}
              <TabJumpButton label="서류·물류" className="btn sm">물류계약 등록 →</TabJumpButton>
            </div>
          </div>
          <div className="bd">
            {inventory.length === 0 ? (
              <div className="note">
                {setupStage
                  ? "투입 계획이 아직 없습니다 — 셋업 단계에서 국가×제품 투입 계획(계획→발송→도착→입고)을 기록하세요."
                  : "셋업 단계에서 국가×제품 투입 계획(계획→발송→도착→입고)이 열립니다."}
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr><th>국가</th><th>제품</th><th>수량</th><th>상태</th></tr>
                </thead>
                <tbody>
                  {inventory.map((i) => (
                    <tr key={i.id}>
                      <td>{COUNTRY_FLAG[i.country] ?? ""} {i.country}</td>
                      <td>{i.product_name ?? "—"}</td>
                      <td>{i.qty.toLocaleString()}</td>
                      <td><span className={`cellchip ${i.status === "stocked" ? "cc-ok" : i.status === "issue" ? "cc-exp" : "cc-ing"}`}>{INV_STATUS[i.status] ?? i.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
