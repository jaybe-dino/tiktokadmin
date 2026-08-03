"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveQnaAnswerAction, approveQnaAction, unapproveQnaAction } from "@/app/(dash)/qna/actions";
import QnaAiButton from "@/components/QnaAiButton";

export type QnaRow = {
  id: string;
  question: string;
  answer: string;
  category?: string | null;
  approved?: boolean | null;
  usage_count?: number | null;
};

export default function QnaKnowledgeTable({ rows }: { rows: QnaRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ id: string; text: string; bad: boolean } | null>(null);
  const [pending, start] = useTransition();

  const cats = useMemo(
    () => Array.from(new Set(rows.map((r) => (r.category || "").trim()).filter(Boolean))),
    [rows]
  );

  const filtered = rows.filter((r) => {
    if (cat && (r.category || "").trim() !== cat) return false;
    if (q && !`${r.question} ${r.answer}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  function toggle(r: QnaRow) {
    setMsg(null);
    if (openId === r.id) {
      setOpenId(null);
    } else {
      setOpenId(r.id);
      setDraft(r.answer || "");
    }
  }

  function saveAnswer(id: string) {
    setMsg(null);
    start(async () => {
      const res = await saveQnaAnswerAction(id, draft);
      if (res.ok) {
        setMsg({ id, text: "답변 저장됨 · 파트장 승인 시 지식화됩니다", bad: false });
        router.refresh();
      } else {
        setMsg({ id, text: res.error || "저장 실패", bad: true });
      }
    });
  }

  function approve(id: string) {
    setMsg(null);
    start(async () => {
      // 답변 편집 중이면 먼저 저장 후 승인
      const trimmed = draft.trim();
      if (trimmed) {
        const s = await saveQnaAnswerAction(id, trimmed);
        if (!s.ok) { setMsg({ id, text: s.error || "저장 실패", bad: true }); return; }
      }
      const res = await approveQnaAction(id);
      if (res.ok) {
        setOpenId(null);
        setMsg({ id, text: "승인 완료 · 지식화됨", bad: false });
        router.refresh();
      } else {
        setMsg({ id, text: res.error || "승인 실패", bad: true });
      }
    });
  }

  function unapprove(id: string) {
    setMsg(null);
    start(async () => {
      const res = await unapproveQnaAction(id);
      if (res.ok) {
        setMsg({ id, text: "승인 취소됨", bad: false });
        router.refresh();
      } else {
        setMsg({ id, text: res.error || "실패", bad: true });
      }
    });
  }

  return (
    <div className="card">
      <div className="bar" style={{ margin: 0, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        <input
          placeholder="질문 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 220 }}
        />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">카테고리 전체</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <table className="t">
        <tbody>
          <tr>
            <th>질문</th>
            <th>카테고리</th>
            <th>재사용</th>
            <th>상태</th>
            <th></th>
          </tr>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "var(--ink3)", padding: "22px 16px", textAlign: "center" }}>
                {rows.length === 0 ? "등록된 QnA가 없습니다." : "검색 결과가 없습니다."}
              </td>
            </tr>
          )}
          {filtered.map((r) => {
            const uses = Number(r.usage_count ?? 0);
            const isOpen = openId === r.id;
            return (
              <tr key={r.id}>
                <td>
                  <b>{r.question}</b>
                  <span className="sub">#{String(r.id).slice(0, 8)}</span>
                  {isOpen && (
                    r.approved ? (
                      <div className="note" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                        {r.answer || "답변 미작성"}
                        <div style={{ marginTop: 8 }}>
                          <button className="btn sm" disabled={pending} onClick={() => unapprove(r.id)}>
                            {pending ? "처리 중…" : "승인 취소"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        <textarea
                          className="f"
                          rows={5}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="답변을 작성하세요"
                        />
                        <QnaAiButton
                          question={r.question}
                          category={r.category || ""}
                          onDraft={(t) => setDraft(t)}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn sm" disabled={pending} onClick={() => saveAnswer(r.id)}>
                            {pending ? "저장 중…" : "답변 저장"}
                          </button>
                          <button className="btn sm pri" disabled={pending} onClick={() => approve(r.id)}>
                            {pending ? "처리 중…" : "저장 후 승인"}
                          </button>
                        </div>
                      </div>
                    )
                  )}
                  {msg && msg.id === r.id && (
                    <div className="note" style={{ marginTop: 8, color: msg.bad ? "#b91c1c" : "#166534" }}>
                      {msg.text}
                    </div>
                  )}
                </td>
                <td>{(r.category || "").trim() || "일반"}</td>
                <td>{uses >= 10 ? <b>{uses}회</b> : `${uses}회`}</td>
                <td>
                  {r.approved ? (
                    <span className="cellchip cc-ok">승인됨</span>
                  ) : r.answer ? (
                    <span className="cellchip cc-warn">승인 대기</span>
                  ) : (
                    <span className="cellchip cc-warn">답변 필요</span>
                  )}
                </td>
                <td>
                  <button
                    className={r.approved ? "btn sm" : "btn sm pri"}
                    onClick={() => toggle(r)}
                  >
                    {isOpen ? "닫기" : r.approved ? "보기" : "답변 작성"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
