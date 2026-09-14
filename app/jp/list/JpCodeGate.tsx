"use client";
// 코드 입력 게이트 — 맞으면 서버가 서명 쿠키를 심고 목록이 열린다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unlockJpListAction } from "./actions";

export default function JpCodeGate() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  function submit() {
    if (pending || !code.trim()) return;
    setErr("");
    start(async () => {
      const r = await unlockJpListAction(code);
      if (!r.ok) { setErr(r.error ?? "확인 실패"); return; }
      router.refresh();
    });
  }

  return (
    <main style={S.page}>
      <div style={S.card}>
        <div style={S.badge}>내부 열람</div>
        <h1 style={S.h1}>일본 사전 신청 현황</h1>
        <p style={S.lead}>열람 코드를 입력해주세요.</p>
        <input
          style={S.input} value={code} autoFocus type="password" inputMode="text"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="코드"
        />
        {err && <div style={S.err}>⚠ {err}</div>}
        <button style={{ ...S.btn, opacity: pending ? 0.6 : 1 }} disabled={pending} onClick={submit}>
          {pending ? "확인 중…" : "열람하기"}
        </button>
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", display: "grid", placeItems: "center", padding: 16,
    background: "linear-gradient(180deg,#f7f8fa,#eef0f4)",
    fontFamily: '-apple-system,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",system-ui,sans-serif', color: "#111827",
  },
  card: { width: "min(360px,94vw)", background: "#fff", borderRadius: 16, padding: "28px 24px", boxShadow: "0 10px 40px rgba(15,23,42,.08)" },
  badge: { display: "inline-block", background: "#1f2937", color: "#fff", fontSize: 11.5, fontWeight: 800, padding: "5px 11px", borderRadius: 999 },
  h1: { fontSize: 20, fontWeight: 900, margin: "14px 0 6px" },
  lead: { fontSize: 13.5, color: "#6b7280", margin: "0 0 16px" },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #d7dce3", borderRadius: 10, padding: "11px 12px", fontSize: 15, letterSpacing: 2 },
  err: { fontSize: 12.5, color: "#b91c1c", marginTop: 8 },
  btn: { width: "100%", marginTop: 14, background: "#1f2937", color: "#fff", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14.5, fontWeight: 800, cursor: "pointer" },
};
