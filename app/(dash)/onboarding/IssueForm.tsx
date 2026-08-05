"use client";
import { useState } from "react";
import { issueCustomerAction } from "./actions";

// 고객 계정 발급 — 이메일 + (선택)브랜드 연결. 코드는 1회 표시.
export default function IssueForm({ brands }: { brands: { id: string; brand_name: string }[] }) {
  const [email, setEmail] = useState("");
  const [brandId, setBrandId] = useState("");
  const [note, setNote] = useState("");
  const [sendMail, setSendMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ email: string; code: string; mailed?: boolean } | null>(null);
  const [error, setError] = useState("");

  async function issue() {
    setBusy(true); setError("");
    const r = await issueCustomerAction(email.trim(), brandId || null, note.trim(), sendMail);
    setBusy(false);
    if (r.ok && r.code) { setResult({ email: email.trim(), code: r.code, mailed: r.mailed }); setEmail(""); setNote(""); setBrandId(""); }
    else setError(r.error ?? "발급 실패");
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <b>고객 계정 발급</b>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
        <label style={lbl}>이메일
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="brand@company.com" style={{ ...inp, width: 220 }} />
        </label>
        <label style={lbl}>연결 브랜드 (선택)
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ ...inp, width: 200 }}>
            <option value="">— 미연결 —</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
          </select>
        </label>
        <label style={lbl}>메모 (선택)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="담당·비고" style={{ ...inp, width: 180 }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink2)", paddingBottom: 9 }}>
          <input type="checkbox" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} /> 발급 후 이메일로 코드·링크 전송
        </label>
        <button className="btn primary" disabled={busy || !email.includes("@")} onClick={issue} style={{ height: 38, opacity: busy || !email.includes("@") ? 0.6 : 1 }}>
          {busy ? "발급 중…" : "발급"}
        </button>
      </div>
      {error && <div style={{ color: "#e03131", fontSize: 13, marginTop: 10 }}>{error}</div>}
      {result && (
        <div style={{ marginTop: 12, background: "#eafaf1", border: "1px solid #12b88655", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, color: "#0b7a52", fontWeight: 700 }}>✅ 발급 완료 — 이 코드는 지금만 표시됩니다. 고객에게 전달하세요.
            {result.mailed === true && " (이메일 전송됨)"}
            {result.mailed === false && " ⚠️ 이메일 전송 실패 — 수동 전달 필요"}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 18, alignItems: "center" }}>
            <div><span style={{ fontSize: 12, color: "#666" }}>이메일</span><div style={{ fontWeight: 600 }}>{result.email}</div></div>
            <div><span style={{ fontSize: 12, color: "#666" }}>발급코드</span><div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 800, letterSpacing: ".12em" }}>{result.code}</div></div>
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(`이메일: ${result.email}\n코드: ${result.code}\n로그인: ${(process.env.NEXT_PUBLIC_PORTAL_URL || "https://tiktok.glovek.space")}/apply`)} style={{ marginLeft: "auto" }}>안내문 복사</button>
            <button className="btn sm" onClick={() => setResult(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12, color: "var(--ink2)", display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 };
const inp: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "var(--bg)" };
