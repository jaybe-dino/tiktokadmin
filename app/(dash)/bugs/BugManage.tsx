"use client";
// 기능오류 제보 관리 행 — 상태 변경 · 개발 추가할 사항 메모 · 삭제.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBugReportAction, deleteBugReportAction } from "./actions";
import { BUG_STATUS } from "@/lib/bug-reports";

export default function BugManage({ id, status, devNote }: { id: string; status: string; devNote: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(devNote);
  const [msg, setMsg] = useState("");

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", marginTop: 8 }}>
      <select
        className="f" style={{ width: "auto", padding: "3px 6px", fontSize: 12 }} defaultValue={status}
        disabled={pending}
        onChange={(e) => start(async () => { await updateBugReportAction(id, { status: e.target.value }); setMsg("상태 변경됨"); router.refresh(); })}
      >
        {BUG_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <textarea
        value={note} onChange={(e) => setNote(e.target.value)} rows={2}
        placeholder="개발 추가할 사항 정리(원인·수정 방향 등)"
        style={{ flex: 1, minWidth: 220, border: "1px solid var(--line)", borderRadius: 8, padding: 8, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }}
      />
      <button className="btn sm pri" disabled={pending}
        onClick={() => start(async () => { await updateBugReportAction(id, { dev_note: note }); setMsg("메모 저장됨"); router.refresh(); })}>
        {pending ? "…" : "메모 저장"}
      </button>
      <button className="btn sm" style={{ color: "var(--danger)" }} disabled={pending}
        onClick={() => { if (confirm("이 제보를 삭제할까요?")) start(async () => { await deleteBugReportAction(id); router.refresh(); }); }}>
        삭제
      </button>
      {msg && <span style={{ fontSize: 11, color: "var(--ok)", alignSelf: "center" }}>{msg}</span>}
    </div>
  );
}
