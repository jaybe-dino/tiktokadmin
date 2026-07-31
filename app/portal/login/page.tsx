"use client";
import { useState } from "react";

export default function PortalLogin() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await fetch("/api/portal/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setDevLink(data.devLink ?? "");
    setSent(true);
    setBusy(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f8", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 400, width: "100%", boxShadow: "0 1px 6px rgba(0,0,0,.06)" }}>
        <div style={{ color: "#e84a80", fontWeight: 700, fontSize: 14 }}>GloveK 브랜드 포털</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 16px" }}>로그인</h1>
        {sent ? (
          <div>
            <p style={{ fontSize: 14, color: "#444" }}>가입된 이메일이라면 로그인 링크를 보내드렸습니다. 메일함을 확인해주세요.</p>
            {devLink && <p style={{ fontSize: 12, marginTop: 12, wordBreak: "break-all" }}>
              (개발) <a href={devLink} style={{ color: "#e84a80" }}>{devLink}</a></p>}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "#888" }}>등록된 담당자 이메일로 로그인 링크를 보내드립니다.</p>
            <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)}
              style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, fontSize: 15 }} />
            <button onClick={submit} disabled={busy || !email}
              style={{ background: "#e84a80", color: "#fff", border: 0, borderRadius: 10, padding: 13, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "전송 중…" : "로그인 링크 받기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
