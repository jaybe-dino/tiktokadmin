"use client";
// 설정 — 마케팅 제안 AI 참고용 '우리 서비스 소개'. 계속 업데이트, AI 제안방향 생성에 반영.
import { useState, useTransition } from "react";
import { saveMktServicesAction } from "@/app/(dash)/mkt/actions";

export default function MktServicesConfigCard({ value, canEdit }: { value: string; canEdit: boolean }) {
  const [md, setMd] = useState(value);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="card">
      <div className="card-hd">
        <b>마케팅 제안 — 우리 서비스 소개 (AI 참고)</b>
        <span style={{ color: "var(--ink3)", fontSize: 11, marginLeft: "auto" }}>제안서의 「AI 제안방향」 생성 시 이 내용을 근거로 사용</span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 10 }}>
        <textarea
          className="input" rows={9} value={md} disabled={!canEdit}
          onChange={(e) => setMd(e.target.value)}
          placeholder={"# 우리 서비스\n- 크리에이터 시딩 · 라이브 커머스\n- 퍼포먼스 광고(틱톡·메타)\n- 콘텐츠 제작 · 현지화\n대상 국가: 미국·일본·동남아 …"}
        />
        {canEdit ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" disabled={pending}
              onClick={() => start(async () => { const r = await saveMktServicesAction(md); setMsg(r.ok ? "저장됨 ✓" : r.error ?? "실패"); })}>
              {pending ? "저장 중…" : "저장"}
            </button>
            {msg && <span className="text-xs" style={{ color: msg.includes("✓") ? "var(--ok)" : "var(--danger)" }}>{msg}</span>}
          </div>
        ) : <div className="note">변경은 파트장/대표만 가능합니다.</div>}
        <div className="note">서비스가 바뀌면 여기서 계속 업데이트하세요 — 이후 생성되는 AI 제안방향에 즉시 반영됩니다.</div>
      </div>
    </div>
  );
}
