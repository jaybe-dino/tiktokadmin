"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

export type AssetRow = {
  id: string;
  kind: string;
  filename: string;
  external_url: string | null;
  storage_url: string | null;
  source: string | null;
  created_at: string | null;
  brand_name: string | null;
  brand_id: string | null;
};

const ICON: Record<string, string> = {
  proposal: "📄", contract: "📎", cert: "📕", doc: "📕", report: "📊",
  meeting_rec: "🎙️", brand_intro: "📕", etc: "📎",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ko-KR");
}

// source 값 → 표시 라벨/스타일 (실데이터 그대로 사용, 없으면 원본 노출)
function sourceChip(source: string | null) {
  const s = (source ?? "").toLowerCase();
  if (s.includes("drive")) return <span className="chip" style={{ background: "#e8f0fe", color: "#1a56db" }}>드라이브</span>;
  if (s.includes("upload") || s.includes("admin")) return <span className="chip">어드민 업로드</span>;
  return <span className="chip">{source || "—"}</span>;
}

type Tab = "files" | "refs" | "drive";

export default function AssetsIndexTabs({ rows, kindLabel }: { rows: AssetRow[]; kindLabel: Record<string, string> }) {
  const [tab, setTab] = useState<Tab>("files");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");

  const kinds = useMemo(() => Array.from(new Set(rows.map((r) => r.kind).filter(Boolean))), [rows]);
  const sources = useMemo(() => Array.from(new Set(rows.map((r) => (r.source ?? "").toLowerCase()).filter(Boolean))), [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (source && (r.source ?? "").toLowerCase() !== source) return false;
    if (q) {
      const hay = `${r.filename} ${r.brand_name ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [rows, q, kind, source]);

  return (
    <div>
      <div className="tabs" id="atabs">
        <button className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>📎 파일 목록</button>
        <button className={tab === "refs" ? "on" : ""} onClick={() => setTab("refs")}>⭐ 레퍼런스 목록</button>
        <button className={tab === "drive" ? "on" : ""} onClick={() => setTab("drive")}>🗂️ 드라이브 연동 · 파트 담당</button>
      </div>

      {tab === "files" && (
        <div className="tp on">
          <div className="bar">
            <input className="f" style={{ width: 230 }} placeholder="🔍 파일명·브랜드 검색"
              value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">종류 전체</option>
              {kinds.map((k) => <option key={k} value={k}>{kindLabel[k] ?? k}</option>)}
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">출처 전체</option>
              {sources.map((s) => <option key={s} value={s}>{s.includes("drive") ? "드라이브" : s.includes("upload") || s.includes("admin") ? "어드민 업로드" : s}</option>)}
            </select>
          </div>
          <div className="card overflow-x-auto">
            <table className="t">
              <thead><tr><th>파일</th><th>출처</th><th>브랜드/용도</th><th>업데이트</th><th></th></tr></thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>{rows.length === 0 ? "색인된 파일이 없습니다." : "조건에 맞는 파일이 없습니다."}</td></tr>
                )}
                {filtered.map((a) => {
                  const url = a.external_url || a.storage_url;
                  return (
                    <tr key={a.id}>
                      <td>{ICON[a.kind] ?? "📎"} <b>{a.filename}</b></td>
                      <td>{sourceChip(a.source)}</td>
                      <td>
                        {a.brand_id
                          ? <Link href={`/brand/${a.brand_id}`} className="hover:underline">{a.brand_name}</Link>
                          : <span style={{ color: "var(--ink3)" }}>—</span>}
                        {" · "}<span style={{ color: "var(--ink3)" }}>{kindLabel[a.kind] ?? a.kind}</span>
                      </td>
                      <td style={{ color: "var(--ink3)" }}>{fmtDate(a.created_at)}</td>
                      <td>{url ? <a href={url} target="_blank" rel="noreferrer"><button className="btn sm">열기 ↗</button></a> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "10px 16px" }} className="note">🔒 민감서류(신분증·여권·카드정보)는 색인 제외 — 원본 시스템 링크만 · 어드민 생성물만 저장하고 원본은 링크로 참조합니다 · <b>모든 화면의 [📎 파일 첨부]는 이 색인(자산 선택기)을 통해서만 첨부됩니다</b></div>
          </div>
        </div>
      )}

      {tab === "refs" && (
        <div className="tp on">
          <div className="bar">
            <input className="f" style={{ width: 230 }} placeholder="🔍 레퍼런스 검색" disabled />
            <select disabled><option>유형 전체</option></select>
          </div>
          <div className="card overflow-x-auto">
            <table className="t">
              <thead><tr><th>레퍼런스</th><th>유형</th><th>태그</th><th>출처</th><th></th></tr></thead>
              <tbody>
                <tr><td colSpan={5} style={{ color: "var(--ink3)" }}>등록된 레퍼런스가 없습니다.</td></tr>
              </tbody>
            </table>
            <div style={{ padding: "10px 16px" }} className="note">⭐ 레퍼런스는 제안서 작성·AI 초안·콘텐츠 제작 시 근거로 자동 추천됩니다 — 성과 콘텐츠는 성과 기준 충족 시 자동 유입됩니다</div>
          </div>
        </div>
      )}

      {tab === "drive" && (
        <div className="tp on">
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14, alignItems: "start" }}>
            <div style={{ display: "grid", gap: 14 }}>
              <div className="card">
                <div className="hd"><b>🗂️ Google Drive 연동 설정</b></div>
                <div className="bd" style={{ fontSize: 12.5 }}>
                  <dl className="kv">
                    <dt>동기화</dt><dd>양방향 · 드라이브에 올려도, 어드민에 올려도 같은 색인에 잡힙니다</dd>
                    <dt>삭제 정책</dt><dd>드라이브에서 삭제 시 어드민에선 <b>아카이브</b> 처리(색인 유지)</dd>
                    <dt>저장 원칙</dt><dd>업로드하면 드라이브 파트 폴더에 저장되고 색인에 자동 등록</dd>
                  </dl>
                  <div style={{ marginTop: 10, fontWeight: 700, fontSize: 12 }}>폴더 ↔ 파트 매핑</div>
                  <table className="t" style={{ marginTop: 6 }}>
                    <thead><tr><th>드라이브 폴더</th><th>파트</th><th>자동 규칙</th></tr></thead>
                    <tbody>
                      <tr><td>📁 01_고객</td><td>고객</td><td>리드 시트·설문 자동 분류</td></tr>
                      <tr><td>📁 02_영업</td><td>영업</td><td>제안서·계약서</td></tr>
                      <tr><td>📁 03_마케팅</td><td>마케팅</td><td>RFP·콘텐츠·레퍼런스</td></tr>
                      <tr><td>📁 04_온보딩제품</td><td>온보딩·제품</td><td>인증·라벨·서류</td></tr>
                      <tr><td>📁 05_운영정산</td><td>운영·정산</td><td>정산서·리포트</td></tr>
                    </tbody>
                  </table>
                  <div className="note" style={{ marginTop: 8 }}>폴더에 올리기만 하면 파트·종류가 자동 분류되어 색인에 등록 — 파일명에 브랜드명이 있으면 해당 브랜드 카드에 자동 연결</div>
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
              <div className="card">
                <div className="hd"><b>👤 파트별 담당 규칙</b></div>
                <div className="bd" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                  로그인한 사용자가 자기 파트의 기본 담당 — 자료를 열어 수정하는 순간 그 사람이 해당 자료의 담당자로 자동 기록됩니다(마지막 수정자 = 현재 담당).
                </div>
              </div>
              <div className="card">
                <div className="hd"><b>📎 첨부 정책</b></div>
                <div className="bd" style={{ fontSize: 12, lineHeight: 1.8 }}>
                  모든 화면의 파일 첨부는 <b>자산 선택기</b>를 통합니다:<br />① 드라이브 검색 → 선택 ② 최근 파일 ③ 새 업로드(→드라이브 저장)<br />어디서 첨부해도 원본은 드라이브 1곳 — 카드에는 링크만 걸려 중복 파일이 생기지 않습니다.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
