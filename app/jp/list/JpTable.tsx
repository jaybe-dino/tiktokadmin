"use client";
// 일본 사전 신청 목록 — 검색·CSV 내려받기·잠그기.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lockJpListAction } from "./actions";
import type { JpApplyRow } from "@/lib/jp-apply";

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
};

export default function JpTable({ rows }: { rows: JpApplyRow[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) =>
      `${r.brand_name} ${r.company} ${r.contact_name} ${r.email} ${r.phone} ${r.jp_sales}`.toLowerCase().includes(kw));
  }, [rows, q]);

  function downloadCsv() {
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = ["신청일시", "브랜드명", "회사명", "담당자", "이메일", "연락처", "인증", "SKU", "일본 판매현황", "추가내용"];
    const body = list.map((r) => [
      fmt(r.applied_at), r.brand_name, r.company, r.contact_name, r.email, r.phone,
      r.cert_status, r.sku_count, r.jp_sales, r.note.replace(/\n/g, " / "),
    ].map(cell).join(","));
    // 엑셀 한글 깨짐 방지 BOM.
    const blob = new Blob(["﻿" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jp-preorder-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <header style={S.head}>
          <div>
            <div style={S.badge}>내부 열람</div>
            <h1 style={S.h1}>일본 사전 신청 현황</h1>
            <p style={S.sub}>총 {rows.length}건{q && ` · 검색 ${list.length}건`}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input style={S.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="브랜드·회사·담당자·이메일 검색" />
            <button style={S.btn} onClick={downloadCsv} disabled={list.length === 0}>⬇ CSV</button>
            <button style={S.btnGhost} onClick={() => start(async () => { await lockJpListAction(); router.refresh(); })}>잠그기</button>
          </div>
        </header>

        {rows.length === 0 ? (
          <div style={S.empty}>아직 접수된 사전 신청이 없습니다.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {["신청일시", "브랜드", "회사명", "담당자", "연락처", "인증", "SKU", "일본 판매현황", ""].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <RowView key={`${r.brand_id}-${i}`} r={r} open={open === `${r.brand_id}-${i}`}
                    onToggle={() => setOpen(open === `${r.brand_id}-${i}` ? null : `${r.brand_id}-${i}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={S.foot}>신청자 개인정보가 포함된 화면입니다 — 화면 공유·캡처에 주의하세요.</p>
      </div>
    </main>
  );
}

function RowView({ r, open, onToggle }: { r: JpApplyRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr style={{ borderTop: "1px solid #eef0f4" }}>
        <td style={S.td}>{fmt(r.applied_at)}</td>
        <td style={{ ...S.td, fontWeight: 700 }}>
          {r.brand_name}
          {r.merged && <span style={S.tag} title="기존 고객과 같은 브랜드로 병합된 신청">기존고객</span>}
        </td>
        <td style={S.td}>{r.company || "—"}</td>
        <td style={S.td}>{r.contact_name || "—"}</td>
        <td style={S.td}>
          <div>{r.email || "—"}</div>
          <div style={{ color: "#9aa3af", fontSize: 12 }}>{r.phone || ""}</div>
        </td>
        <td style={S.td}>{r.cert_status || "—"}</td>
        <td style={S.td}>{r.sku_count || "—"}</td>
        <td style={S.td}>{r.jp_sales || "—"}</td>
        <td style={S.td}>
          <button style={S.link} onClick={onToggle}>{open ? "접기" : "상세"}</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ ...S.td, background: "#f7f8fa" }}>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
              {r.note || "추가로 작성한 내용이 없습니다."}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa3af", marginTop: 8 }}>
              현재 단계: {r.state}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", padding: "28px 16px", background: "linear-gradient(180deg,#f7f8fa,#eef0f4)",
    fontFamily: '-apple-system,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",system-ui,sans-serif', color: "#111827",
  },
  wrap: { maxWidth: 1180, margin: "0 auto", background: "#fff", borderRadius: 16, padding: "22px 20px", boxShadow: "0 10px 40px rgba(15,23,42,.07)" },
  head: { display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 16 },
  badge: { display: "inline-block", background: "#1f2937", color: "#fff", fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 999 },
  h1: { fontSize: 21, fontWeight: 900, margin: "10px 0 4px" },
  sub: { fontSize: 13, color: "#6b7280", margin: 0 },
  search: { border: "1px solid #d7dce3", borderRadius: 10, padding: "9px 11px", fontSize: 13, minWidth: 220 },
  btn: { background: "#1f2937", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  btnGhost: { background: "#fff", color: "#4b5563", border: "1px solid #d7dce3", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "9px 10px", color: "#6b7280", fontSize: 12, fontWeight: 700, borderBottom: "1px solid #e2e6ec", whiteSpace: "nowrap" },
  td: { padding: "10px 10px", verticalAlign: "top" },
  tag: { marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#6b7280", background: "#eef0f4", padding: "2px 6px", borderRadius: 999 },
  link: { background: "none", border: "none", color: "#1f2937", fontSize: 12.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline" },
  empty: { padding: "40px 10px", textAlign: "center", color: "#6b7280", fontSize: 14 },
  foot: { fontSize: 11.5, color: "#9aa3af", marginTop: 16, marginBottom: 0 },
};
