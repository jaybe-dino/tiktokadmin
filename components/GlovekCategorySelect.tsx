"use client";
// glovek DB 의 "실제 카테고리 값" 선택 — 하드코딩 분류 대신 실값 그대로 골라 정확히 매칭시키는 용도.
//   버튼으로 목록을 불러온 뒤(건수 내림차순) 선택하면 onPick(실값) 호출.
import { useState } from "react";
import { listGlovekCategoriesAction } from "@/app/(dash)/mkt-proposals/actions";

export default function GlovekCategorySelect({ onPick }: { onPick: (value: string) => void }) {
  const [cats, setCats] = useState<{ value: string; count: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await listGlovekCategoriesAction();
      if (!r.ok || !r.categories?.length) { setErr(r.error ?? "불러오기 실패"); return; }
      setCats(r.categories);
    } catch { setErr("불러오기 실패 — 다시 시도해주세요."); }
    finally { setBusy(false); }
  }

  if (cats === null) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button className="btn sm" type="button" disabled={busy} onClick={load} title="glovek DB 에 실제 저장된 카테고리 값 목록을 불러와 그대로 선택(정확 매칭)">
          {busy ? "실값 불러오는 중…" : "📂 glovek 실값 카테고리"}
        </button>
        {err && <span style={{ fontSize: 10.5, color: "#b3261e", maxWidth: 360 }}>{err}</span>}
      </span>
    );
  }
  return (
    <select className="f" defaultValue="" style={{ maxWidth: 240 }}
      onChange={(e) => { if (e.target.value) onPick(e.target.value); }}>
      <option value="">glovek 실값 선택 ({cats.length})</option>
      {cats.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count.toLocaleString("ko-KR")})</option>)}
    </select>
  );
}
