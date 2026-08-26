"use client";
// 콘텐츠 브리프 설문 카드(마케팅 파트) — 브랜드별 발급 목록 + 제품명 지정 발급 + 링크 복사 + 응답 열람.
//   제품별로 여러 개 발급 가능. 응답 여부(⏳/✅)와 제품 라벨로 구분한다.
import { useEffect, useState, useTransition } from "react";
import {
  listContentBriefsAction, createContentBriefAction, getContentBriefAnswersAction, deleteContentBriefAction,
  type ContentBriefRow,
} from "@/app/(dash)/mkt/actions";

export default function ContentBriefCard({ brandId }: { brandId: string | null }) {
  const [briefs, setBriefs] = useState<ContentBriefRow[] | null>(null);
  const [product, setProduct] = useState("");
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [qa, setQa] = useState<{ section?: string; label: string; answer: string }[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!brandId) { setBriefs([]); return; }
    listContentBriefsAction(brandId).then((r) => setBriefs(r.briefs ?? []));
  }, [brandId]);

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => setMsg("링크를 복사했습니다 — 브랜드 담당자에게 전달하세요."));
  }
  function create() {
    if (!brandId) { setMsg("브랜드 미연결 — 브랜드 연결 후 발급하세요."); return; }
    start(async () => {
      const r = await createContentBriefAction(brandId, product);
      if (!r.ok) { setMsg(r.error ?? "발급 실패"); return; }
      setProduct("");
      if (r.url) copy(r.url);
      const l = await listContentBriefsAction(brandId);
      setBriefs(l.briefs ?? []);
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
    start(async () => {
      await deleteContentBriefAction(id);
      if (brandId) { const l = await listContentBriefsAction(brandId); setBriefs(l.briefs ?? []); }
      if (openId === id) setOpenId(null);
    });
  }

  const sections: string[] = [];
  for (const x of qa) { const s = x.section ?? ""; if (!sections.includes(s)) sections.push(s); }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 12.5 }}>📝 콘텐츠 브리프 설문</b>
        <span style={{ fontSize: 10.5, color: "var(--ink3)" }}>제품별로 여러 개 발급 가능 — 브랜드 담당자가 작성</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          <input className="f" value={product} onChange={(e) => setProduct(e.target.value)}
            placeholder="제품명(선택) — 예: 고마쥬 클렌징 밤" style={{ width: 200, fontSize: 12 }} />
          <button className="btn sm pri" disabled={pending || !brandId} onClick={create}
            title="발급 즉시 공개 링크가 복사됩니다">+ 발급·링크복사</button>
        </span>
      </div>
      {msg && <div style={{ fontSize: 11, color: "var(--ink2)", marginTop: 6 }}>{msg}</div>}
      {briefs === null ? (
        <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 8 }}>불러오는 중…</div>
      ) : briefs.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 8 }}>발급된 브리프가 없습니다 — 제품명을 넣고 발급하세요.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
          {briefs.map((b) => (
            <div key={b.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span>{b.responded_at ? "✅" : "⏳"}</span>
                <b>{b.product_label}</b>
                <span style={{ color: "var(--ink3)", fontSize: 10.5 }}>
                  {new Date(b.created_at).toLocaleDateString("ko-KR")} {b.responded_at ? "· 응답 완료" : "· 응답 대기"}
                </span>
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                  <button className="btn sm" onClick={() => copy(b.url)}>🔗 링크</button>
                  {b.responded_at && <button className="btn sm" disabled={pending} onClick={() => view(b.id)}>{openId === b.id ? "닫기" : "응답 보기"}</button>}
                  <button className="btn sm" disabled={pending} onClick={() => del(b.id)} title="브리프 삭제">✕</button>
                </span>
              </div>
              {openId === b.id && (
                <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", margin: "6px 0 4px", maxHeight: 380, overflowY: "auto" }}>
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
  );
}
