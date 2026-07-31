"use client";
import { useState } from "react";

export default function InquiryForm() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await fetch("/api/portal/inquiry", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });
    if (res.ok) { setDone(true); setSubject(""); setBody(""); }
    setBusy(false);
  }

  if (done) {
    return <div style={{ background: "#e8f7ee", borderRadius: 10, padding: 14, fontSize: 14, color: "#1a8a3f" }}>
      문의가 접수되었습니다. 담당자가 확인 후 연락드립니다.
      <button onClick={() => setDone(false)} style={{ marginLeft: 8, color: "#666", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>새 문의</button>
    </div>;
  }

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <input placeholder="제목" value={subject} onChange={(e) => setSubject(e.target.value)}
        style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10, fontSize: 14 }} />
      <textarea placeholder="문의 내용" rows={4} value={body} onChange={(e) => setBody(e.target.value)}
        style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10, fontSize: 14 }} />
      <button onClick={submit} disabled={busy || !subject}
        style={{ background: "#e84a80", color: "#fff", border: 0, borderRadius: 8, padding: 11, fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
        {busy ? "접수 중…" : "문의 보내기"}
      </button>
    </div>
  );
}
