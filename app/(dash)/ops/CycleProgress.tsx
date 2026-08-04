"use client";
// 워크아이템 진척 입력 — 사이클 행에서 종류별 qty_done 을 갱신(ops#1·#3).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWorkItemProgressAction } from "./actions";

interface Item { id: string; kind: string; qty_target: number; qty_done: number; status: string }

const KIND_LABEL: Record<string, string> = {
  seeding: "시딩", live: "라이브", report: "리포트", ads: "광고", listing: "리스팅", etc: "기타",
};

export default function CycleProgress({ items }: { items: Item[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  if (items.length === 0) {
    return <span style={{ color: "var(--ink3)", fontSize: 11 }}>항목 없음</span>;
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>{open ? "닫기" : "진척 입력"}</button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, width: 240, padding: 10, textAlign: "left" }}>
          {items.map((it) => (
            <Row key={it.id} it={it} pending={pending}
              onSave={(v) => start(async () => {
                setMsg("");
                const r = await setWorkItemProgressAction(it.id, v);
                setMsg(r.ok ? "저장됨" : r.error ?? "실패");
                router.refresh();
              })} />
          ))}
          {msg && <div className="note" style={{ marginTop: 6, color: "var(--ok)", fontSize: 11 }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

function Row({ it, pending, onSave }: { it: Item; pending: boolean; onSave: (v: number) => void }) {
  const [val, setVal] = useState(String(it.qty_done));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ flex: 1, fontSize: 12 }}>{KIND_LABEL[it.kind] ?? it.kind}</span>
      <input className="input" type="number" min={0} max={it.qty_target} value={val}
        onChange={(e) => setVal(e.target.value)} style={{ width: 52, fontSize: 12, padding: "2px 4px" }} />
      <span style={{ fontSize: 11, color: "var(--ink3)" }}>/{it.qty_target}</span>
      <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => onSave(Number(val))} style={{ padding: "2px 6px" }}>저장</button>
    </div>
  );
}
