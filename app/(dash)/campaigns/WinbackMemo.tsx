"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { saveWinbackMemoAction } from "./actions";

// 윈백 리스트 "메모" — 재접촉 메모(next_action)·예정일(due_date) 인라인 편집.
export default function WinbackMemo({
  brandId,
  initialNote,
  initialDue,
}: {
  brandId: string;
  initialNote: string;
  initialDue: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(initialNote);
  const [due, setDue] = useState(initialDue);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function save() {
    setErr("");
    start(async () => {
      const r = await saveWinbackMemoAction(brandId, note, due);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setErr(r.error ?? "저장 실패");
      }
    });
  }

  if (!open) {
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        메모
      </button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
      <input
        className="input"
        placeholder="재접촉 메모·다음 액션"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ fontSize: 12 }}
      />
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          className="input"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          style={{ fontSize: 12 }}
        />
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={save}>
          {pending ? "저장 중…" : "저장"}
        </button>
        <button className="btn btn-sm" disabled={pending} onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
      {err && <span style={{ fontSize: 11, color: "var(--warn)" }}>{err}</span>}
    </div>
  );
}
