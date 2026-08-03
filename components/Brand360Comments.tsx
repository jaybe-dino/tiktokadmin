"use client";

// v3.1 메모·협업 탭 — 코멘트(comments 테이블 · addCommentAction) + 감사 이력·안전장치(실데이터).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCommentAction } from "@/app/(dash)/brand360/actions";

export interface CommentRow { id: string; author: string; body: string; created_at: string }
export interface HistoryRow { from_state: string | null; to_state: string; actor: string; at: string }

export default function Brand360Comments({ brandId, comments, history, viewers }: {
  brandId: string;
  comments: CommentRow[];
  history: HistoryRow[];
  viewers: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");

  return (
    <div className="grid g2" style={{ gap: 14 }}>
      {/* ── 코멘트 ── */}
      <div className="card">
        <div className="hd"><b>코멘트</b>{comments.length > 0 && <span className="chip">{comments.length}</span>}</div>
        <div className="bd">
          {comments.length === 0 && <p className="note">아직 코멘트가 없습니다 — 첫 메모를 남겨보세요.</p>}
          {comments.map((c) => (
            <div className="row" key={c.id}>
              <span className="av">{c.author.slice(0, 2)}</span>
              <div>
                <div className="tt">
                  {c.author}{" "}
                  <span style={{ color: "var(--ink3)", fontWeight: 400, fontSize: 11 }}>
                    {c.created_at.slice(5, 16).replace("T", " ")}
                  </span>
                </div>
                <div className="ss" style={{ color: "var(--ink)", whiteSpace: "pre-wrap" }}>{c.body}</div>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <input
              className="f"
              placeholder="코멘트 입력 · @멘션 가능"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && text.trim() && !pending) {
                  start(async () => {
                    const r = await addCommentAction(brandId, text);
                    setMsg(r.ok ? "" : r.error ?? "실패");
                    if (r.ok) setText("");
                    router.refresh();
                  });
                }
              }}
            />
            <button
              className="btn pri"
              disabled={pending || !text.trim()}
              onClick={() =>
                start(async () => {
                  const r = await addCommentAction(brandId, text);
                  setMsg(r.ok ? "" : r.error ?? "실패");
                  if (r.ok) setText("");
                  router.refresh();
                })
              }
            >
              등록
            </button>
          </div>
          {msg && <div className="note" style={{ marginTop: 6 }}>{msg}</div>}
        </div>
      </div>

      {/* ── 감사 이력 · 안전장치 ── */}
      <div className="card">
        <div className="hd"><b>감사 이력 · 안전장치</b></div>
        <div className="bd" style={{ fontSize: 12 }}>
          <div className="row">
            <span className="ico" style={{ background: "#dbeafe" }}>🔒</span>
            <div>
              <div className="tt">동시 수정 잠금</div>
              <div className="ss">
                {viewers.length > 0 ? `현재 열람: ${viewers.join(", ")} — 충돌 시 버전 검사로 경고` : "현재 다른 열람자 없음 — 충돌 시 버전 검사로 경고"}
              </div>
            </div>
          </div>
          <div className="row">
            <span className="ico" style={{ background: "#dcfce7" }}>🧾</span>
            <div>
              <div className="tt">상태 이동 이력 {history.length}건</div>
              <div className="ss">
                {history.length === 0
                  ? "아직 상태 이동 기록이 없습니다"
                  : history.slice(0, 3).map((h) => `${h.from_state ?? "?"}→${h.to_state}(${h.at.slice(5, 10)} ${h.actor})`).join(" · ")}
              </div>
            </div>
          </div>
          <div className="row">
            <span className="ico" style={{ background: "#fef3c7" }}>🛡️</span>
            <div>
              <div className="tt">민감정보 정책</div>
              <div className="ss">카드·신분증 원본은 저장되지 않음 — 요약+원본 링크만</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
