"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createQnaAction } from "@/app/(dash)/qna/actions";
import QnaAiButton from "@/components/QnaAiButton";

// QnA 지식베이스 헤더의 "+ 직접 등록" — 신규 질문/답변을 승인 전 상태로 등록.
export default function QnaCreateButton({ categories }: { categories: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("");
  const [answer, setAnswer] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setErr("");
    start(async () => {
      const res = await createQnaAction({
        question: String(f.get("question") || ""),
        answer: String(f.get("answer") || ""),
        category: String(f.get("category") || ""),
      });
      if (res.ok) {
        form.reset();
        setQuestion("");
        setCategory("");
        setAnswer("");
        setOpen(false);
        router.refresh();
      } else {
        setErr(res.error || "등록 실패");
      }
    });
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="btn pri" type="button" onClick={() => { setErr(""); setOpen(true); }}>
        + 직접 등록
      </button>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,36,64,.28)", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}
          onClick={() => setOpen(false)}
        >
          <div className="modal" style={{ width: 480, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="mh">
              <b>+ QnA 직접 등록</b>
              <span className="x" onClick={() => setOpen(false)}>✕</span>
            </div>
            <form onSubmit={submit}>
              <div className="mb" style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>
                  등록 시 &quot;승인 대기&quot; 상태로 저장됩니다. 파트장 승인 시 지식화되어 답장 초안에 자동 삽입돼요.
                </div>
                <input name="question" className="f" placeholder="질문 *" required value={question} onChange={(e) => setQuestion(e.target.value)} />
                <input name="category" className="f" placeholder="카테고리 (예: 인증/물류/정산/플랜/운영)" list="qna-cat-list" value={category} onChange={(e) => setCategory(e.target.value)} />
                <datalist id="qna-cat-list">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
                <textarea name="answer" className="f" rows={5} placeholder="답변 (비워두면 [답변 필요]로 표시)" value={answer} onChange={(e) => setAnswer(e.target.value)} />
                <QnaAiButton question={question} category={category} onDraft={(t) => setAnswer(t)} />
                {err && <div className="note" style={{ color: "#b91c1c" }}>{err}</div>}
              </div>
              <div className="mf">
                <button className="btn" type="button" onClick={() => setOpen(false)}>취소</button>
                <button className="btn pri" type="submit" disabled={pending}>{pending ? "등록 중…" : "등록"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
