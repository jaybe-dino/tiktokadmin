"use client";
import { useState } from "react";
import type { SurveyQuestion } from "@/lib/survey";

export default function SurveyForm({ token, questions }: { token: string; questions: SurveyQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  function set(key: string, value: unknown) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }
  function toggleMulti(key: string, opt: string) {
    setAnswers((a) => {
      const cur = Array.isArray(a[key]) ? (a[key] as string[]) : [];
      return { ...a, [key]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
    });
  }

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      // /s/[token]/submit — 응답 저장(기존 게이트) + 사전 설문 회사정보 반영·타임라인 기록.
      const res = await fetch(`/s/${token}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "제출 실패");
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <p style={{ fontWeight: 700, fontSize: 18 }}>응답이 제출되었습니다.</p>
        <p style={{ color: "#888", fontSize: 14, marginTop: 8 }}>감사합니다!</p>
      </div>
    );
  }

  // 섹션(주제) 순서를 등장 순으로 보존해 그룹 렌더.
  const sections: string[] = [];
  for (const q of questions) { const s = q.section ?? ""; if (!sections.includes(s)) sections.push(s); }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {sections.map((sec) => (
        <div key={sec || "_"} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {sec && <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".04em", color: "#c0326a", borderBottom: "1px solid #f2dbe6", paddingBottom: 6 }}>{sec}</div>}
          {questions.filter((q) => (q.section ?? "") === sec).map((q) => (
        <div key={q.key}>
          <label style={{ display: "block", fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{q.label}</label>

          {q.type === "select" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {q.options!.map((o) => (
                <button key={o} type="button" onClick={() => set(q.key, o)}
                  style={chip(answers[q.key] === o)}>{o}</button>
              ))}
            </div>
          )}

          {q.type === "multi" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {q.options!.map((o) => {
                const on = Array.isArray(answers[q.key]) && (answers[q.key] as string[]).includes(o);
                return (
                  <button key={o} type="button" onClick={() => toggleMulti(q.key, o)}
                    style={chip(on)}>{o}</button>
                );
              })}
            </div>
          )}

          {q.type === "short" && (
            <input type="text" value={(answers[q.key] as string) ?? ""}
              onChange={(e) => set(q.key, e.target.value)}
              style={{ width: "100%", border: "1px solid #ddd", borderRadius: 10, padding: 10, fontSize: 14 }}
              placeholder={q.placeholder ?? ""} />
          )}

          {q.type === "text" && (
            <textarea rows={3} value={(answers[q.key] as string) ?? ""}
              onChange={(e) => set(q.key, e.target.value)}
              style={{ width: "100%", border: "1px solid #ddd", borderRadius: 10, padding: 10, fontSize: 14 }}
              placeholder="자유롭게 적어주세요" />
          )}

          {q.type === "consent" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={Boolean(answers[q.key])}
                onChange={(e) => set(q.key, e.target.checked)} />
              동의합니다
            </label>
          )}
        </div>
          ))}
        </div>
      ))}

      {err && <p style={{ color: "#e11", fontSize: 13 }}>{err}</p>}

      <button type="button" onClick={submit} disabled={busy}
        style={{ background: "#e84a80", color: "#fff", border: 0, borderRadius: 12, padding: "14px", fontSize: 16, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
        {busy ? "제출 중…" : "제출하기"}
      </button>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    border: active ? "1.5px solid #e84a80" : "1px solid #ddd",
    background: active ? "#fdeef4" : "#fff",
    color: active ? "#c0326a" : "#444",
    borderRadius: 999, padding: "8px 14px", fontSize: 14, cursor: "pointer", fontWeight: active ? 600 : 400,
  };
}
