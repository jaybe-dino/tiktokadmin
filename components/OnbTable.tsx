"use client";
// 온보딩 파이프라인 표 뷰 — 체크 후 담당자 지정·단계 이동 일괄 처리.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { OnbCard, OnbStageKey } from "@/lib/onboarding-pipeline";
import { setOnbStageAction } from "@/app/(dash)/onboarding-pipeline/actions";
import { assignBrandOwnerAction } from "@/app/actions";

type Stage = { key: OnbStageKey; label: string; slaDays: number | null };

export default function OnbTable({ stages, groups, held = [], owners }: {
  stages: Stage[];
  groups: Record<OnbStageKey, OnbCard[]>;
  held?: OnbCard[];
  owners: { id: string; name: string }[];
}) {
  const router = useRouter();
  const rows = [...stages.flatMap((s) => (groups[s.key] ?? [])), ...held];
  const labelOf = (k: OnbStageKey) => stages.find((s) => s.key === k)?.label ?? k;
  const ownerName = (id: string | null) => (id ? (owners.find((o) => o.id === id)?.name ?? id) : null);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [assignUser, setAssignUser] = useState("");
  const [moveStage, setMoveStage] = useState<OnbStageKey | "">("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState("");

  const ids = rows.map((r) => r.brand_id);
  const allChecked = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(ids));

  async function runBulk(fn: (id: string) => Promise<{ ok: boolean }>, doneMsg: (ok: number, fail: number) => string) {
    if (sel.size === 0 || busy) return;
    const list = [...sel];
    setBusy(true); setMsg(""); setProgress({ done: 0, total: list.length });
    let ok = 0, fail = 0;
    for (let i = 0; i < list.length; i++) {
      try { const r = await fn(list[i]); r.ok ? ok++ : fail++; } catch { fail++; }
      setProgress({ done: i + 1, total: list.length });
    }
    setBusy(false); setProgress(null); setSel(new Set());
    setMsg(doneMsg(ok, fail));
    router.refresh();
  }
  const doAssign = () => {
    if (!assignUser) { setMsg("배정할 담당자를 선택하세요."); return; }
    const label = owners.find((o) => o.id === assignUser)?.name ?? "담당";
    runBulk((id) => assignBrandOwnerAction(id, "owner_onboard", assignUser), (ok, fail) => `${ok}건 온보딩 담당 '${label}' 배정${fail ? ` · ${fail}건 실패` : ""}`);
  };
  const doMove = () => {
    if (!moveStage) { setMsg("이동할 단계를 선택하세요."); return; }
    runBulk((id) => setOnbStageAction(id, moveStage), (ok, fail) => `${ok}건 '${labelOf(moveStage as OnbStageKey)}' 단계로 이동${fail ? ` · ${fail}건 실패` : ""}`);
  };

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      {/* 일괄 작업 툴바 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--ink3)" }}>{sel.size > 0 ? `${sel.size}건 선택됨` : "행 체크로 선택"}</span>
        {msg && <span style={{ fontSize: 12, color: "var(--ok)" }}>{msg}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select className="f" style={{ width: 130, padding: "3px 6px", fontSize: 12 }} value={assignUser} onChange={(e) => setAssignUser(e.target.value)}>
            <option value="">담당자 선택</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" disabled={busy || sel.size === 0 || !assignUser} onClick={doAssign}>담당 배정{sel.size ? ` (${sel.size})` : ""}</button>
          <select className="f" style={{ width: 130, padding: "3px 6px", fontSize: 12 }} value={moveStage} onChange={(e) => setMoveStage(e.target.value as OnbStageKey | "")}>
            <option value="">단계 이동…</option>
            {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button className="btn btn-sm" disabled={busy || sel.size === 0 || !moveStage} onClick={doMove}>단계 이동{sel.size ? ` (${sel.size})` : ""}</button>
        </div>
      </div>
      {progress && (
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 8, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`, height: "100%", background: "var(--acc)", transition: "width .15s" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)", whiteSpace: "nowrap" }}>
            {progress.done}/{progress.total} ({progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%)
          </span>
        </div>
      )}
      <table className="t">
        <thead>
          <tr>
            <th style={{ width: 28 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="전체 선택" /></th>
            <th>브랜드</th><th>단계</th><th>온보딩 담당</th><th>신청상태</th><th>제품</th><th>SLA</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} style={{ padding: "24px 12px", textAlign: "center", color: "var(--ink3)" }}>대상 브랜드 없음</td></tr>}
          {rows.map((c) => {
            const checked = sel.has(c.brand_id);
            const sla = stages.find((s) => s.key === c.stage)?.slaDays ?? null;
            return (
              <tr key={c.brand_id} style={{ background: checked ? "rgba(37,99,235,.08)" : c.overSla ? "rgba(254,226,226,.35)" : undefined }}>
                <td><input type="checkbox" checked={checked} onChange={() => toggle(c.brand_id)} /></td>
                <td><Link href={`/brand/${c.brand_id}`} style={{ fontWeight: 700, color: "inherit" }}>{c.brand_name}</Link></td>
                <td>{c.held
                  ? <span className="pill" style={{ background: "#fef3c7", color: "#b45309" }}>보류</span>
                  : <><span className="pill">{labelOf(c.stage)}</span>{c.overridden && <span style={{ fontSize: 9, color: "#7c3aed", marginLeft: 4 }}>수동</span>}</>}</td>
                <td style={{ fontSize: 12 }}>{ownerName(c.owner_onboard) ?? <span style={{ color: "var(--danger)", fontWeight: 700 }}>미배정</span>}</td>
                <td style={{ fontSize: 12, color: "var(--ink3)" }}>{c.app_status ?? "—"}</td>
                <td style={{ fontSize: 12 }}>{c.product_count || "—"}</td>
                <td>{sla != null ? <span className={`sla ${c.overSla ? "t2" : c.ageDays >= sla - 1 ? "t1" : "ok"}`}>{c.overSla ? `+${c.ageDays - sla}일` : `D${c.ageDays}`}</span> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
