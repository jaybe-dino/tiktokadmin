"use client";
// 상단 전역 검색 — 클릭 이동이 아니라 입력 즉시 검색(디바운스). 이메일·회사명·대표자명·담당자 매칭.
//   각 결과 밑에 '어느 필드에서 매칭됐는지'(파트별 키워드)를 살짝 표시한다.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Hit { brand_id: string; brand_name: string; state: string | null; matches: { label: string; value: string }[] }

const STATE_KO: Record<string, string> = {
  lead_new: "리드", seminar: "담당배정", meeting: "미팅", contact: "컨택", contract_review: "계약검토",
  contract_done: "계약완료", docs: "서류수급", setup: "셋업", live_mall: "운영", live_onboarding: "온보딩",
  settling: "정산", hold: "보류", dropped: "드랍", churned: "이탈",
};

export default function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 바깥 클릭 시 닫기.
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // 디바운스 검색.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 1) { setHits([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const j = await r.json();
        setHits(Array.isArray(j.hits) ? j.hits : []);
        setActive(-1);
      } catch { setHits([]); }
      setLoading(false);
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  function go(id: string) { setOpen(false); setQ(""); router.push(`/brand/${id}`); }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === "Enter") {
      if (active >= 0 && hits[active]) go(hits[active].brand_id);
      else if (q.trim()) { setOpen(false); router.push(`/customers?q=${encodeURIComponent(q.trim())}`); }
    } else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div ref={boxRef} className="relative flex-[0_1_460px]">
      <div className="flex items-center gap-2 rounded-[9px] px-3 py-1.5"
        style={{ background: "var(--bg)", border: "1px solid var(--line)" }}>
        <span>🔍</span>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="이메일·회사명·대표자·담당자 검색"
          className="flex-1 bg-transparent outline-none text-[13px]"
          style={{ color: "var(--ink1)" }}
        />
        {q && <button onClick={() => { setQ(""); setHits([]); }} style={{ color: "var(--ink3)", fontSize: 13 }} title="지우기">✕</button>}
      </div>

      {open && q.trim().length >= 1 && (
        <div className="absolute left-0 right-0 mt-1 rounded-[10px] bg-white shadow-lg z-50 overflow-hidden"
          style={{ border: "1px solid var(--line)", maxHeight: "70vh", overflowY: "auto" }}>
          {loading && <div className="px-3 py-3 text-[12.5px]" style={{ color: "var(--ink3)" }}>검색 중…</div>}
          {!loading && hits.length === 0 && (
            <div className="px-3 py-3 text-[12.5px]" style={{ color: "var(--ink3)" }}>「{q.trim()}」 결과 없음</div>
          )}
          {!loading && hits.map((h, i) => (
            <button key={h.brand_id} onClick={() => go(h.brand_id)} onMouseEnter={() => setActive(i)}
              className="block w-full text-left px-3 py-2"
              style={{ background: active === i ? "var(--bg)" : "#fff", borderBottom: "1px solid var(--line)" }}>
              <div className="flex items-center gap-2">
                <b className="text-[13px]" style={{ color: "var(--ink1)" }}>{h.brand_name || "(브랜드명 없음)"}</b>
                {h.state && <span className="text-[10.5px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg)", color: "var(--ink3)" }}>{STATE_KO[h.state] ?? h.state}</span>}
              </div>
              {h.matches.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {h.matches.slice(0, 4).map((m, k) => (
                    <span key={k} className="text-[11px]" style={{ color: "var(--ink3)" }}>
                      <span style={{ color: "var(--acc)" }}>{m.label}</span> · {m.value.length > 40 ? m.value.slice(0, 40) + "…" : m.value}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
          {!loading && hits.length > 0 && (
            <button onClick={() => { setOpen(false); router.push(`/customers?q=${encodeURIComponent(q.trim())}`); }}
              className="block w-full text-left px-3 py-2 text-[12px]" style={{ color: "var(--acc)", background: "#fff" }}>
              고객 목록에서 「{q.trim()}」 전체 검색 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
