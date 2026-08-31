"use client";
// 콘텐츠 브리프 "참조" 패널(읽기 전용) — 루틴 회차 진행·마케팅 제안서 작성 중에
//   브랜드가 제출한 브리프 응답을 그 자리에서 펼쳐 본다. 기본은 접힘이며 펼칠 때만
//   조회하므로, 참조하지 않는 경우에는 아무 부담이 없다(발급·삭제는 여기서 하지 않음).
import { useState, useTransition } from "react";
import {
  listContentBriefsAction, getContentBriefAnswersAction, type ContentBriefRow,
} from "@/app/(dash)/mkt/actions";

export default function ContentBriefRef({ brandId, compact = false }: { brandId: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [briefs, setBriefs] = useState<ContentBriefRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [qa, setQa] = useState<{ section?: string; label: string; answer: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || briefs !== null) return;
    if (!brandId) { setBriefs([]); return; }
    start(async () => {
      const r = await listContentBriefsAction(brandId);
      setBriefs(r.briefs ?? []);
      if (!r.ok) setMsg(r.error ?? "불러오기 실패");
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

  const sections: string[] = [];
  for (const x of qa) { const s = x.section ?? ""; if (!sections.includes(s)) sections.push(s); }
  const answered = (briefs ?? []).filter((b) => b.responded_at);

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: compact ? "8px 10px" : "10px 12px", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm" onClick={toggle} disabled={pending}>
          {open ? "▾" : "▸"} 📝 콘텐츠 브리프 참조
        </button>
        <span style={{ fontSize: 10.5, color: "var(--ink3)" }}>
          브랜드가 제출한 콘텐츠 설문 응답을 참고합니다(선택 — 펼칠 때만 조회)
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          {msg && <div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 6 }}>{msg}</div>}
          {!brandId ? (
            <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>브랜드가 연결되지 않아 참조할 브리프가 없습니다.</div>
          ) : briefs === null ? (
            <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>불러오는 중…</div>
          ) : answered.length === 0 ? (
            <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>
              응답 완료된 브리프가 없습니다{briefs.length > 0 ? ` (발급 ${briefs.length}건 · 응답 대기)` : ""} —
              「마케팅 &gt; 콘텐츠 브리프」에서 발급·회수할 수 있습니다.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {answered.map((b) => (
                <div key={b.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span>✅</span>
                    <b>{b.product_label}</b>
                    <span style={{ color: "var(--ink3)", fontSize: 10.5 }}>
                      {b.responded_at ? new Date(b.responded_at).toLocaleDateString("ko-KR") : ""}
                    </span>
                    <button className="btn sm" style={{ marginLeft: "auto" }} disabled={pending} onClick={() => view(b.id)}>
                      {openId === b.id ? "닫기" : "내용 보기"}
                    </button>
                  </div>
                  {openId === b.id && (
                    <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", margin: "6px 0 4px", maxHeight: 340, overflowY: "auto" }}>
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
      )}
    </div>
  );
}
