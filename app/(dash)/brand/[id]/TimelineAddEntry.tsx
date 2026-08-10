"use client";
// 타임라인 직접 입력(4-3) — 담당이 임의 메모/이벤트를 타임라인에 남긴다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTimelineEntryAction } from "@/app/(dash)/brand360/actions";

export default function TimelineAddEntry({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");

  const add = () => start(async () => {
    setMsg("");
    const r = await addTimelineEntryAction(brandId, text);
    if (r.ok) { setText(""); router.refresh(); } else setMsg(r.error ?? "실패");
  });

  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
      <input
        className="f"
        style={{ flex: 1, minWidth: 200 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) add(); }}
        placeholder="타임라인에 직접 기록 (예: 유선 통화 — 다음 주 견적 회신 예정)"
      />
      <button className="btn sm pri" disabled={pending || !text.trim()} onClick={add}>{pending ? "기록 중…" : "＋ 기록"}</button>
      {msg && <span className="note" style={{ color: "var(--bad)" }}>{msg}</span>}
    </div>
  );
}
