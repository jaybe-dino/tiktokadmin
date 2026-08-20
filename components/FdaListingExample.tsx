// FDA Direct — Cosmetic Product Listing 예시 화면(재현 목업). apply Step4 첨부 예시용.
//   실제 FDA Direct 제출 화면을 참고용으로 재현 — 담당자가 무엇을 준비/캡처해야 하는지 안내.
const box: React.CSSProperties = { background: "#eceef1", border: "1px solid #d7dbe0", borderRadius: 3, height: 20 };
const lbl: React.CSSProperties = { fontSize: 10, color: "#3a3f45", lineHeight: 1.25 };
const req = <span style={{ color: "#d11" }}> *</span>;

function Field({ label, value }: { label: React.ReactNode; value?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <div style={lbl}>{label}</div>
      <div style={{ ...box, background: value ? "#fff" : "#eceef1", display: "flex", alignItems: "center", padding: value ? "0 6px" : 0, fontSize: 10, color: "#333" }}>{value ?? ""}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e5e9", borderRadius: 4, padding: 12, marginTop: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#2b3138", letterSpacing: ".02em", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export default function FdaListingExample() {
  return (
    <div style={{ border: "1px solid #d7dbe0", borderRadius: 6, overflow: "hidden", background: "#f4f5f7", maxWidth: 640, fontFamily: "Arial, sans-serif" }}>
      {/* HHS 상단 스트립 */}
      <div style={{ background: "#0b0c0e", color: "#c7ccd2", fontSize: 8.5, padding: "3px 10px", display: "flex", justifyContent: "space-between" }}>
        <span>U.S. Department of Health and Human Services</span><span>Welcome　·　Logout</span>
      </div>
      {/* FDA Direct 헤더 */}
      <div style={{ background: "#1f3350", color: "#fff", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <b style={{ fontSize: 16, letterSpacing: ".02em" }}>FDA <span style={{ fontStyle: "italic", fontWeight: 400 }}>Direct</span></b>
        <span style={{ background: "#16233a", width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12 }}>✕</span>
      </div>
      {/* 브레드크럼 탭 */}
      <div style={{ display: "flex", gap: 4, padding: "8px 12px", fontSize: 9.5 }}>
        {["All Submissions", "Cosmetic Product Listing"].map((t) => (
          <span key={t} style={{ background: "#dfe3e8", color: "#3a3f45", padding: "3px 12px", borderRadius: "3px 12px 12px 3px" }}>{t}</span>
        ))}
        <span style={{ background: "#2f6fb0", color: "#fff", padding: "3px 12px", borderRadius: "3px 12px 12px 3px" }}>Cosmetic Products</span>
      </div>

      <div style={{ padding: "0 12px 12px" }}>
        <Section title="DOCUMENT TYPE DETAILS">
          <Field label="Document Type:" value="Cosmetic Product Listing" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Field label={<>Set ID:{req}</>} />
              <Field label={<>Root ID:{req}</>} />
            </div>
            <div>
              <Field label={<>Version Number:{req}</>} />
              <Field label={<>Effective Date:{req}</>} value="07-22-2024" />
            </div>
          </div>
        </Section>

        <Section title="PRODUCT, INGREDIENT AND FACILITY OF THE COSMETIC PRODUCT">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Field label={<>Responsible Person<br />(as listed on the label):</>} />
              <Field label={<>Responsible Person Name<br />(as listed on the label):{req}</>} />
              <Field label={<>Parent Company Name (if<br />applicable):</>} />
            </div>
            <div>
              <Field label={<>Responsible Person Phone Number (include<br />Country/Area Code):{req}</>} />
              <Field label={<>Responsible Person D&B D-U-N-S Number for<br />Address Listed on the Product Label:</>} />
            </div>
          </div>
        </Section>

        <Section title="PRODUCT(S), INGREDIENT(S), AND FACILITY (IES)">
          <div style={{ display: "grid", gridTemplateColumns: "60px 1.4fr 1.6fr 1.4fr", background: "#1f3350", color: "#fff", fontSize: 9, fontWeight: 700, padding: "6px 8px", borderRadius: "3px 3px 0 0" }}>
            <span>Edit</span><span>Cosmetic Product Listing Number</span><span>Product Name (as listed on label)</span><span>Product Marketing Status</span>
          </div>
          <div style={{ background: "#eceef1", height: 22, borderBottom: "3px solid #fff" }} />
          <div style={{ background: "#eceef1", height: 22 }} />
        </Section>
      </div>
    </div>
  );
}
