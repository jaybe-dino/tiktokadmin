"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveTemplateAction } from "../actions";
import type { ProposalTemplate } from "@/lib/proposal-doc";

const ALL_SECTIONS: [string, string][] = [
  ["cover", "표지"], ["product", "핵심 SKU"], ["pricing", "요약(가격)"], ["operations", "로드맵/기대효과"],
  ["kpi", "KPI"], ["addon", "별도 제안"], ["creators", "레퍼런스"], ["closing", "마무리"],
];

export default function TemplateEditor({ tpl }: { tpl: ProposalTemplate }) {
  const router = useRouter();
  const [t, setT] = useState<ProposalTemplate>(tpl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = <K extends keyof ProposalTemplate>(k: K, v: ProposalTemplate[K]) => setT((p) => ({ ...p, [k]: v }));

  function toggleSection(key: string) {
    const has = t.sections.includes(key);
    set("sections", has ? t.sections.filter((s) => s !== key) : [...t.sections, key]);
  }

  async function save() {
    setBusy(true);
    const r = await saveTemplateAction({
      id: t.id, name: t.name, accent: t.accent, agency_name: t.agency_name, agency_logo_url: t.agency_logo_url,
      default_title: t.default_title, default_subtitle: t.default_subtitle, sections: t.sections,
      contact_name: t.contact_name, contact_title: t.contact_title, contact_phone: t.contact_phone, contact_email: t.contact_email,
    });
    setBusy(false);
    setMsg(r.ok ? "저장되었습니다." : r.error ?? "저장 실패");
    setTimeout(() => setMsg(""), 2500);
    if (r.ok) router.refresh();
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <b>{t.name}</b>
        {t.is_default && <span className="chip grn" style={{ fontSize: 10 }}>기본</span>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 20, height: 20, borderRadius: 5, background: t.accent, border: "1px solid var(--line)" }} />
          <button className="btn sm primary" disabled={busy} onClick={save}>저장</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <L label="템플릿명"><input className="f" value={t.name} onChange={(e) => set("name", e.target.value)} /></L>
        <L label="강조색"><input className="f" type="text" value={t.accent} onChange={(e) => set("accent", e.target.value)} placeholder="#1f7a4d" /></L>
        <L label="대행사명"><input className="f" value={t.agency_name} onChange={(e) => set("agency_name", e.target.value)} /></L>
        <L label="대행사 로고 URL"><input className="f" value={t.agency_logo_url ?? ""} onChange={(e) => set("agency_logo_url", e.target.value || null)} /></L>
        <L label="기본 제목" full><input className="f" value={t.default_title} onChange={(e) => set("default_title", e.target.value)} /></L>
        <L label="기본 부제" full><input className="f" value={t.default_subtitle} onChange={(e) => set("default_subtitle", e.target.value)} /></L>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600, margin: "14px 0 6px" }}>마무리(E.O.D.) 담당자 연락처</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <L label="담당자명"><input className="f" value={t.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value || null)} placeholder="Sung Kyung Lee" /></L>
        <L label="직책"><input className="f" value={t.contact_title ?? ""} onChange={(e) => set("contact_title", e.target.value || null)} placeholder="Marketing Team Lead" /></L>
        <L label="연락처"><input className="f" value={t.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value || null)} placeholder="+82-10-0000-0000" /></L>
        <L label="이메일"><input className="f" value={t.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value || null)} placeholder="name@dinostudio.kr" /></L>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600, marginBottom: 6 }}>노출 섹션 (체크 = 표시)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ALL_SECTIONS.map(([key, label]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, padding: "5px 10px", cursor: "pointer", background: t.sections.includes(key) ? "var(--tint, #eef7f2)" : "transparent" }}>
              <input type="checkbox" checked={t.sections.includes(key)} onChange={() => toggleSection(key)} /> {label}
            </label>
          ))}
        </div>
      </div>
      {msg && <div className="note" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

function L({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600, display: "block", gridColumn: full ? "1 / -1" : undefined }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}
