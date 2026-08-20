"use client";
// LOA(수권서) 문서 뷰 — 서명 이미지 포함 A4 인쇄용. [PDF 저장] → 브라우저 인쇄로 PDF 출력.
import Link from "next/link";

const S = (v: unknown) => (v == null ? "" : String(v)).trim();

export default function LoaDocument({ app, backHref, downloadHref }: { app: Record<string, unknown>; backHref: string; downloadHref: string }) {
  const f = (k: string) => S(app[k]) || "____________";
  const sig = S(app.ubo_signature_data);
  const signedAt = S(app.ubo_signed_at);

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh" }}>
      {/* 인쇄 시 문서만 남기고 나머지 숨김(레이아웃 무관 격리) */}
      <style>{`
        @media print {
          @page { size: A4; margin: 18mm; }
          body * { visibility: hidden !important; }
          #loa-doc, #loa-doc * { visibility: visible !important; }
          #loa-doc { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; margin: 0 !important; border: none !important; }
          .loa-noprint { display: none !important; }
        }
      `}</style>

      <div className="loa-noprint" style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 16px", position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid #e5e7eb", zIndex: 10 }}>
        <Link href={backHref} className="btn sm">← 검토로</Link>
        <b style={{ fontSize: 14 }}>LOA 수권서 · 서명 문서</b>
        <a href={downloadHref} className="btn sm pri" style={{ marginLeft: "auto" }}>⬇️ PDF 다운로드</a>
        <button onClick={() => window.print()} className="btn sm">🖨️ 인쇄</button>
      </div>

      <div style={{ maxWidth: 820, margin: "20px auto", padding: "0 16px" }}>
        <div id="loa-doc" style={{ background: "#fff", border: "1px solid #e2e6eb", borderRadius: 10, padding: 40, color: "#1f2937", lineHeight: 1.8, fontSize: 14 }}>
          <h1 style={{ textAlign: "center", fontSize: 22, fontWeight: 800, marginBottom: 26, letterSpacing: ".05em" }}>LETTER OF AUTHORIZATION</h1>

          <p style={{ marginBottom: 16 }}>
            This letter serves as an official authorization for <b>{f("ubo_full_name")}</b>, {f("ubo_title")} of <b>{f("company_name_en")}</b>,
            to represent the company in all matters concerning our TikTok Shop business.
          </p>
          <p style={{ marginBottom: 6, fontWeight: 600 }}>{f("ubo_full_name")} is hereby authorized to:</p>
          <ul style={{ paddingLeft: 22, marginBottom: 16 }}>
            <li>Register and operate a TikTok Shop account</li>
            <li>List and sell [{f("product_category")}] products</li>
            <li>Manage all business operations related to TikTok Shop</li>
            <li>Handle all transactions, communications, and administrative matters</li>
            <li>Make business decisions on behalf of [{f("company_name_en")}]</li>
          </ul>
          <p style={{ marginBottom: 24 }}>This authorization is valid from the date of this letter and shall remain in effect until revoked in writing.</p>

          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
            <b>Brand Information</b>
            <ul style={{ fontSize: 13, marginTop: 6, paddingLeft: 16, listStyle: "none" }}>
              <li>• Brand name: {f("shop_name_en")}</li>
              <li>• Company: {f("company_name_en")}</li>
              <li>• Authorized Representative: {f("ubo_full_name")}</li>
              <li>• Position: {f("ubo_title")}</li>
            </ul>
          </div>

          <div style={{ marginTop: 30, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <b>Authorized by</b>
              <div style={{ height: 90, border: "1px solid #d5dae1", borderRadius: 8, background: "#fff", marginTop: 8, display: "grid", placeItems: "center", overflow: "hidden" }}>
                {sig
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={sig} alt="서명" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                  : <span style={{ color: "#9ca3af", fontSize: 13 }}>미서명</span>}
              </div>
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <b>{f("ubo_full_name")}</b>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{f("ubo_title")}</div>
                {signedAt && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Signed at {signedAt.slice(0, 10)}</div>}
              </div>
            </div>
            <div>
              <b>Acknowledged by</b>
              <div style={{ height: 90, border: "1px solid #d5dae1", borderRadius: 8, background: "#fff", marginTop: 8, display: "grid", placeItems: "center", fontStyle: "italic", fontSize: 26, color: "#374151", fontFamily: "'Brush Script MT', cursive" }}>Hur Jeongbal</div>
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <b>DINO STUDIO INC.</b>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Hur Jeongbal · CEO</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
