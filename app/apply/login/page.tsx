"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// 고객 온보딩 로그인 — 이메일 + 발급코드.
export default function ApplyLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true); setError("");
    const res = await fetch("/api/apply/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (data.ok) {
      // ?next=/apply/products 처럼 포털 내 경로가 지정되면 그 페이지로 복귀(외부 경로는 무시).
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next && next.startsWith("/apply") ? next : "/apply");
      router.refresh();
    } else setError(data.error ?? "로그인에 실패했습니다.");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 34, maxWidth: 420, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,.4)" }}>
        <div style={{ color: "#12b886", fontWeight: 800, fontSize: 13, letterSpacing: ".04em" }}>TikTok Shop 온보딩</div>
        <h1 style={{ fontSize: 23, fontWeight: 800, margin: "6px 0 4px", color: "#111" }}>브랜드 신청서 로그인</h1>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 18 }}>담당자가 안내한 이메일과 발급코드를 입력하세요.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>이메일
            <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)}
              style={inp} />
          </label>
          <label style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>발급코드
            <input type="text" placeholder="예: A1B2C3D4" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && email && code && submit()}
              style={{ ...inp, letterSpacing: ".14em", fontFamily: "monospace", fontSize: 17 }} />
          </label>
          {error && <div style={{ color: "#e03131", fontSize: 13, background: "#fff0f0", padding: "8px 10px", borderRadius: 8 }}>{error}</div>}
          <button onClick={submit} disabled={busy || !email || !code}
            style={{ background: "#12b886", color: "#fff", border: 0, borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy || !email || !code ? 0.55 : 1, marginTop: 4 }}>
            {busy ? "확인 중…" : "로그인"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", border: "1px solid #dde1e6", borderRadius: 10, padding: 12, fontSize: 15, marginTop: 5, boxSizing: "border-box", color: "#111" };
