"use client";
// 타임라인 직접 입력 메모 — 인라인 수정·삭제(BUG-30).
//   자동 기록(상태 이동·미팅·메일 등)에는 붙지 않는다 — 서버가 노트 행에만 noteId 를 넣어준다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTimelineEntryAction, deleteTimelineEntryAction } from "@/app/(dash)/brand360/actions";

export default function TimelineNoteRow({ noteId, text }: { noteId: string; text: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [err, setErr] = useState("");

  const save = () => start(async () => {
    setErr("");
    const r = await updateTimelineEntryAction(noteId, draft);
    if (r.ok) { setEditing(false); router.refresh(); } else setErr(r.error ?? "수정 실패");
  });
  const remove = () => {
    if (!confirm("이 타임라인 기록을 삭제할까요? 되돌릴 수 없습니다.")) return;
    start(async () => {
      setErr("");
      const r = await deleteTimelineEntryAction(noteId);
      if (r.ok) router.refresh(); else setErr(r.error ?? "삭제 실패");
    });
  };

  if (editing) {
    return (
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap", width: "100%" }}>
        <input className="f" style={{ flex: 1, minWidth: 180, fontSize: 12.5 }} value={draft} autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) save();
            if (e.key === "Escape") { setDraft(text); setEditing(false); setErr(""); }
          }} />
        <button className="btn sm pri" disabled={pending || !draft.trim()} onClick={save}>저장</button>
        <button className="btn sm" disabled={pending} onClick={() => { setDraft(text); setEditing(false); setErr(""); }}>취소</button>
        {err && <span className="note" style={{ color: "var(--bad)" }}>{err}</span>}
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5 }}>📝 {text}</span>
      <button className="btn sm" disabled={pending} onClick={() => setEditing(true)} title="기록 수정">✎</button>
      <button className="btn sm" disabled={pending} onClick={remove} title="기록 삭제" style={{ color: "var(--bad)" }}>🗑</button>
      {err && <span className="note" style={{ color: "var(--bad)" }}>{err}</span>}
    </span>
  );
}
