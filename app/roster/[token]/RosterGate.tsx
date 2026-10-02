"use client";
// 비밀번호 입력 화면. 링크가 없는 경우와 비밀번호가 틀린 경우를 같은 문구로 돌려준다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rosterLoginAction } from "./actions";

export default function RosterGate({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  const submit = () => start(async () => {
    setErr("");
    const r = await rosterLoginAction(token, pw);
    if (!r.ok) { setErr(r.error ?? "열람 정보가 올바르지 않습니다."); return; }
    setPw("");
    router.refresh();
  });

  return (
    <main style={S.page}>
      <div style={S.card}>
        <div style={S.badge}>참석자 명단 열람</div>
        <h1 style={S.h1}>비밀번호를 입력해주세요</h1>
        <p style={S.lead}>전달받은 열람 비밀번호를 입력하면 해당 행사의 명단만 보입니다.</p>
        <input
          style={S.input} type="password" value={pw} autoComplete="off"
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !pending) submit(); }}
          placeholder="열람 비밀번호"
        />
        {err && <div style={S.err}>{err}</div>}
        <button style={{ ...S.btn, opacity: pending ? 0.6 : 1 }} disabled={pending || !pw} onClick={submit}>
          {pending ? "확인 중…" : "열람하기"}
        </button>
        <p style={S.foot}>이 페이지는 읽기 전용입니다 — 명단을 수정할 수 없습니다.</p>
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0f1115", padding: "48px 16px", display: "flex", justifyContent: "center", alignItems: "flex-start" },
  card: { width: "100%", maxWidth: 420, background: "#fff", borderRadius: 18, padding: "26px 24px 24px" },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: ".12em", color: "#1d4ed8", background: "#eef4ff", borderRadius: 999, padding: "4px 10px" },
  h1: { fontSize: 19, fontWeight: 800, color: "#111", margin: "12px 0 8px" },
  lead: { fontSize: 13, color: "#6b7280", lineHeight: 1.75, margin: "0 0 16px" },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #dfe3e8", borderRadius: 10, padding: "12px 12px", fontSize: 14, color: "#111" },
  err: { marginTop: 12, fontSize: 12.5, color: "#c92a2a" },
  btn: { width: "100%", border: 0, borderRadius: 12, background: "#111827", color: "#fff", padding: "13px 18px", fontSize: 14.5, fontWeight: 800, cursor: "pointer", marginTop: 14 },
  foot: { fontSize: 11, color: "#9aa3af", lineHeight: 1.7, margin: "14px 0 0" },
};
