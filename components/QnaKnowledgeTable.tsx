"use client";

import { useMemo, useState } from "react";

export type QnaRow = {
  id: string;
  question: string;
  answer: string;
  category?: string | null;
  approved?: boolean | null;
  usage_count?: number | null;
};

export default function QnaKnowledgeTable({ rows }: { rows: QnaRow[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const cats = useMemo(
    () => Array.from(new Set(rows.map((r) => (r.category || "").trim()).filter(Boolean))),
    [rows]
  );

  const filtered = rows.filter((r) => {
    if (cat && (r.category || "").trim() !== cat) return false;
    if (q && !`${r.question} ${r.answer}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

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
                    <div className="note" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                      {r.answer || "답변 미작성"}
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
                    onClick={() => setOpenId(isOpen ? null : r.id)}
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
