"use client";
// 콘텐츠 브리프 관리 화면 — 발급(브랜드+제품명) · 회수 현황(응답/대기) · 응답 열람 · 삭제.
//   프로젝트 상세·브랜드 360 의 카드와 같은 서버 액션을 쓰므로 어디서 발급하든 목록이 일치한다.
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  listAllContentBriefsAction, createContentBriefAction, getContentBriefAnswersAction, deleteContentBriefAction,
  type ContentBriefRow,
} from "@/app/(dash)/mkt/actions";

type Row = ContentBriefRow & { brand_id: string; brand_name: string };

export default function ContentBriefsScreen({ brands }: { brands: { id: string; brand_name: string }[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [brandId, setBrandId] = useState("");
  const [product, setProduct] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "waiting" | "done">("all");
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [qa, setQa] = useState<{ section?: string; label: string; answer: string }[]>([]);
  const [pending, start] = useTransition();

  const reload = () => listAllContentBriefsAction().then((r) => setRows(r.briefs ?? []));
  useEffect(() => { reload(); }, []);

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => setMsg("링크를 복사했습니다 — 브랜드 담당자에게 전달하세요."));
  }
  function create() {
    if (!brandId) { setMsg("브랜드를 선택하세요."); return; }
    start(async () => {
      const r = await createContentBriefAction(brandId, product);
      if (!r.ok) { setMsg(r.error ?? "발급 실패"); return; }
      setProduct("");
      if (r.url) copy(r.url);
      await reload();
    });
  }
  function view(id: string) {
    if (openId === id) { setOpenId(null); return; }
    start(async () => {
      const r = await getContentBriefAnswersAction(id);
      if (!r.ok) { setMsg(r.error ?? "열람 실패"); return; }
      setQa(r.qa ?? []); setOpenId(id);
    });
  }
  function del(id: string) {
    if (!confirm("이 브리프 설문(링크)을 삭제할까요? 응답도 함께 삭제됩니다.")) return;
    start(async () => { await deleteContentBriefAction(id); if (openId === id) setOpenId(null); await reload(); });
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (only === "waiting" && r.responded_at) return false;
      if (only === "done" && !r.responded_at) return false;
      if (!kw) return true;
      return `${r.brand_name} ${r.product_label}`.toLowerCase().includes(kw);
    });
  }, [rows, q, only]);

  const waiting = (rows ?? []).filter((r) => !r.responded_at).length;
  const done = (rows ?? []).length - waiting;
  const sections: string[] = [];
  for (const x of qa) { const s = x.section ?? ""; if (!sections.includes(s)) sections.push(s); }

  return (
    <>
      <div className="card" style={{ padding: 14, marginTop: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ fontSize: 13 }}>+ 브리프 발급</b>
          <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ minWidth: 190 }}>
            <option value="">브랜드 선택…</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
          </select>
          <input className="f" value={product} onChange={(e) => setProduct(e.target.value)}
            placeholder="제품명(선택) — 예: 고마쥬 클렌징 밤" style={{ minWidth: 230 }} />
          <button className="btn sm pri" disabled={pending || !brandId} onClick={create}
            title="발급 즉시 공개 링크가 복사됩니다">발급·링크복사</button>
          <span style={{ fontSize: 11, color: "var(--ink3)" }}>제품별로 여러 개 발급할 수 있습니다.</span>
        </div>
        {msg && <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ fontSize: 13 }}>발급 목록</b>
          <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>응답 완료 {done} · 대기 {waiting}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
            <select className="f" value={only} onChange={(e) => setOnly(e.target.value as typeof only)} style={{ fontSize: 12 }}>
              <option value="all">전체</option>
              <option value="waiting">응답 대기</option>
              <option value="done">응답 완료</option>
            </select>
            <input className="f" value={q} onChange={(e) => setQ(e.target.value)} placeholder="브랜드·제품 검색" style={{ fontSize: 12, width: 170 }} />
          </span>
        </div>
        {rows === null ? (
          <div style={{ padding: 20, color: "var(--ink3)", fontSize: 13 }}>불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 20, color: "var(--ink2)", fontSize: 13 }}>
            {(rows ?? []).length === 0 ? "발급된 브리프가 없습니다 — 위에서 브랜드를 골라 발급하세요." : "조건에 맞는 브리프가 없습니다."}
          </div>
        ) : (
          <div>
            {filtered.map((r) => (
              <div key={r.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
                  <span>{r.responded_at ? "✅" : "⏳"}</span>
                  <Link href={`/brand/${r.brand_id}`} className="chip" style={{ fontSize: 11 }}>{r.brand_name} ↗</Link>
                  <b>{r.product_label}</b>
                  <span style={{ color: "var(--ink3)", fontSize: 11 }}>
                    {new Date(r.created_at).toLocaleDateString("ko-KR")} 발급
                    {r.responded_at ? ` · ${new Date(r.responded_at).toLocaleDateString("ko-KR")} 응답` : " · 응답 대기"}
                  </span>
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                    <button className="btn sm" onClick={() => copy(r.url)}>🔗 링크</button>
                    {r.responded_at && <button className="btn sm" disabled={pending} onClick={() => view(r.id)}>{openId === r.id ? "닫기" : "응답 보기"}</button>}
                    <button className="btn sm" disabled={pending} onClick={() => del(r.id)} title="브리프 삭제">✕</button>
                  </span>
                </div>
                {openId === r.id && (
                  <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", marginTop: 8, maxHeight: 420, overflowY: "auto" }}>
                    {sections.map((sec) => (
                      <div key={sec || "_"} style={{ marginBottom: 10 }}>
                        {sec && <div style={{ fontSize: 11, fontWeight: 800, color: "var(--acc, #c0326a)", margin: "6px 0" }}>{sec}</div>}
                        {qa.filter((x) => (x.section ?? "") === sec).map((x, i) => (
                          <div key={i} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 600 }}>{x.label}</div>
                            <div style={{ fontSize: 12, color: "var(--ink2)", whiteSpace: "pre-wrap" }}>{x.answer}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                    {qa.length === 0 && <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>응답 내용이 없습니다.</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
