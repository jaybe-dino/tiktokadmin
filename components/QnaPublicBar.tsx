"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importQnaAction } from "@/app/(dash)/qna/actions";

// QnA 외부 공개 바 — 공개 FAQ 링크 복사/열기 + 붙여넣기 일괄 가져오기.
export default function QnaPublicBar({ publicBase }: { publicBase: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [approve, setApprove] = useState(true);
  const [msg, setMsg] = useState("");
  const url = `${publicBase.replace(/\/$/, "")}/faq`;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3200); };

  function doImport() {
    if (!text.trim()) { flash("내용을 붙여넣으세요."); return; }
    start(async () => {
      const r = await importQnaAction({ text, approve });
      if (r.ok) { flash(`가져오기 완료 — 추가 ${r.added ?? 0} · 건너뜀 ${r.skipped ?? 0}`); setText(""); router.refresh(); }
      else flash(r.error ?? "가져오기 실패");
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <a className="btn sm" href={url} target="_blank" rel="noreferrer" title="외부 공개 FAQ 페이지">🌐 외부 공개 FAQ ↗</a>
        <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(url); flash("공개 링크 복사됨"); }}>공개 링크 복사</button>
        <button className="btn sm" onClick={() => setOpen((o) => !o)}>{open ? "가져오기 닫기" : "📥 붙여넣기 가져오기"}</button>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>승인된 항목만 공개됩니다</span>
      </div>
      {open && (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 6 }}>
            FAQ 문서를 붙여넣으세요. 형식: <code>[카테고리]</code> 줄 · <code>Q: 질문</code> · <code>A: 답변</code>(여러 줄 가능).
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
            placeholder={"[정산]\nQ: 정산 주기는 어떻게 되나요?\nA: 매월 정산되며 ...\n\n[물류]\nQ: 미국 배송은 얼마나 걸리나요?\nA: ..."}
            style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: 10, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink2)" }}>
              <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> 바로 공개(승인) — 파트장/대표
            </label>
            <button className="btn sm pri" disabled={pending} onClick={doImport} style={{ marginLeft: "auto" }}>
              {pending ? "가져오는 중…" : "가져오기"}
            </button>
          </div>
        </div>
      )}
      {msg && <div className="note">{msg}</div>}
    </div>
  );
}
