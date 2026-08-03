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
  version: string | null;
  owner: string | null;
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// v3.1: 단일 색인 테이블 — 파일·브랜드·종류·연결된 카드·버전·업데이트·담당
export default function AssetsIndexTabs({ rows, kindLabel, cardLabel }: {
  rows: AssetRow[];
  kindLabel: Record<string, string>;
  cardLabel: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [brand, setBrand] = useState("");

  const kinds = useMemo(() => Array.from(new Set(rows.map((r) => r.kind).filter(Boolean))), [rows]);
  const brands = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.brand_id && r.brand_name) m.set(r.brand_id, r.brand_name);
    return Array.from(m.entries());
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (brand && r.brand_id !== brand) return false;
    if (q) {
      const hay = `${r.filename} ${r.brand_name ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [rows, q, kind, brand]);

  return (
    <div>
      <div className="bar">
        <input className="f" style={{ width: 230 }} placeholder="🔍 파일명·브랜드 검색"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">종류 전체</option>
          {kinds.map((k) => <option key={k} value={k}>{kindLabel[k] ?? k}</option>)}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">브랜드 전체</option>
          {brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      <div className="card overflow-x-auto">
        <table className="t">
          <thead>
            <tr><th>파일</th><th>브랜드</th><th>종류</th><th>연결된 카드</th><th>버전</th><th>업데이트</th><th>담당</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ color: "var(--ink3)" }}>
                {rows.length === 0 ? "색인된 파일이 없습니다." : "조건에 맞는 파일이 없습니다."}
              </td></tr>
            )}
            {filtered.map((a) => {
              const url = a.external_url || a.storage_url;
              const card = cardLabel[a.kind];
              return (
                <tr key={a.id}>
                  <td>📎 {url
                    ? <a href={url} target="_blank" rel="noreferrer" className="hover:underline"><b>{a.filename}</b></a>
                    : <b>{a.filename}</b>}</td>
                  <td>{a.brand_id
                    ? <Link href={`/brand/${a.brand_id}`} className="hover:underline">{a.brand_name}</Link>
                    : <span style={{ color: "var(--ink3)" }}>—</span>}</td>
                  <td>{kindLabel[a.kind] ?? a.kind}</td>
                  <td>{card && a.brand_id
                    ? <Link href={`/brand/${a.brand_id}`} className="hover:underline">{card}</Link>
                    : card ?? <span style={{ color: "var(--ink3)" }}>—</span>}</td>
                  <td>{a.version ?? <span style={{ color: "var(--ink3)" }}>—</span>}</td>
                  <td style={{ color: "var(--ink3)" }}>{fmtDate(a.created_at)}</td>
                  <td>{a.owner ?? <span style={{ color: "var(--ink3)" }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "10px 16px" }} className="note">
          🔒 민감서류(신분증·여권·카드정보)는 여기 저장되지 않습니다 — 원본 시스템 링크만 · 같은 파일 재업로드 시 버전 자동 증가 · 모든 카드의 첨부가 이 색인에 자동 등록
        </div>
      </div>
    </div>
  );
}
