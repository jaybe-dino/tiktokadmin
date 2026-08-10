"use client";
// 미팅↔브랜드 맵핑 리스트 관리 — 연결된 미팅을 한눈에 보고 해제/재지정/삭제.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConnectBrand from "./ConnectBrand";
import { deleteMeetingAction, unmapMeetingBrandAction } from "./actions";

export interface MappedMeeting {
  id: string; topic: string; brand_id: string; brand_name: string; when: string; status: string;
}

export default function MeetingMappings({ rows, brands }: { rows: MappedMeeting[]; brands: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reassign, setReassign] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const unmap = (id: string) => { if (confirm("브랜드 연결을 해제할까요?")) start(async () => { const r = await unmapMeetingBrandAction(id); if (!r.ok) setMsg(r.error ?? "실패"); router.refresh(); }); };
  const del = (id: string) => { if (confirm("이 일정을 삭제할까요? 완전히 제거됩니다.")) start(async () => { const r = await deleteMeetingAction(id); if (!r.ok) setMsg(r.error ?? "실패"); router.refresh(); }); };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="hd">
        <b>브랜드 맵핑 리스트</b>
        <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: 6 }}>연결된 미팅 {rows.length}건 · 해제/재지정/삭제</span>
      </div>
      <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
        {rows.length === 0 && <div style={{ color: "var(--ink3)" }}>브랜드에 연결된 미팅이 없습니다.</div>}
        {rows.map((m) => (
          <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line)", padding: "5px 0" }}>
            <span className="pill" style={{ fontVariantNumeric: "tabular-nums" }}>{m.when}</span>
            <Link href={`/brand/${m.brand_id}`} style={{ color: "var(--acc)", fontWeight: 700 }}>{m.brand_name}</Link>
            <span style={{ color: "var(--ink3)" }}>{m.topic || "(제목 없음)"}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {reassign === m.id
                ? <ConnectBrand meetingId={m.id} brands={brands} />
                : <button className="btn sm" disabled={pending} onClick={() => setReassign(m.id)}>브랜드 변경</button>}
              <button className="btn sm" disabled={pending} onClick={() => unmap(m.id)}>연결 해제</button>
              <button className="btn sm" disabled={pending} style={{ color: "var(--bad)" }} onClick={() => del(m.id)}>삭제</button>
            </span>
          </div>
        ))}
        {msg && <div className="note" style={{ color: "var(--bad)" }}>{msg}</div>}
      </div>
    </div>
  );
}
