"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { transitionAction } from "@/app/actions";
import { STATE_LABELS, type State } from "@/lib/types";
import type { BoardCard } from "@/lib/repo/queries";

const COLUMNS: State[] = [
  "lead_new", "seminar", "meeting", "contact", "contract_review",
  "contract_done", "docs", "setup", "live_mall", "live_onboarding", "settling",
];

// 단계별 컬럼 헤더 점 색상 (파트 매핑)
const DOT: Record<string, string> = {
  lead_new: "#d97706", seminar: "#d97706", meeting: "#2563eb", contact: "#2563eb",
  contract_review: "#2563eb", contract_done: "#2563eb", docs: "#16a34a", setup: "#16a34a",
  live_mall: "#9333ea", live_onboarding: "#9333ea", settling: "#0d9488",
};

export default function Board({ cards: propCards }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [cards, setCards] = useState(propCards);
  const [toast, setToast] = useState<{ msg: string; bad: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // 서버 새로고침으로 새 데이터가 오면 로컬 상태 동기화
  useEffect(() => setCards(propCards), [propCards]);

  const byState = (s: State) => cards.filter((c) => c.state === s);

  async function onDrop(to: State) {
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.state === to) return;

    // 낙관적 업데이트 — 카드를 즉시 이동
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, state: to } : c)));

    const res = await transitionAction(id, to);
    if (res.ok) {
      setToast({ msg: `${card.brand_name} → ${STATE_LABELS[to]}`, bad: false });
      router.refresh();
    } else {
      setCards(prev); // 실패 시 원위치
      const detail = res.failed?.map((f) => f.label).join(" · ") || res.error || "이동 실패";
      setToast({ msg: `이동 불가: ${detail}`, bad: true });
    }
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div>
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg ${
            toast.bad ? "bg-bad text-white" : "bg-good text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
      <div className="kb">
        {COLUMNS.map((s) => {
          const list = byState(s);
          const breaches = list.filter((c) => c.has_breach).length;
          const over = dragId && cards.find((c) => c.id === dragId)?.state !== s;
          return (
            <div
              key={s}
              className={`kcol ${over ? "dragover" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(s)}
            >
              <h4 className="flex items-center gap-1.5 text-[12px] mx-1 mt-0.5 mb-2.5" style={{ color: "var(--ink2)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: DOT[s] ?? "#94a3b8" }} />
                {STATE_LABELS[s]}
                <span className="ml-auto bg-white rounded-lg px-1.5 text-[11px]" style={{ color: "var(--ink3)" }}>
                  {list.length}{breaches > 0 && <span className="text-bad font-bold"> ·{breaches}⚠</span>}
                </span>
              </h4>
              <div className="min-h-[60px]">
                {list.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    className="kcard"
                    style={c.has_breach ? { borderColor: "#fca5a5" } : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/brand/${c.id}`} className="font-bold text-[12.5px] truncate hover:underline">
                        {c.brand_name}
                      </Link>
                      {c.grade && <span className={`gr gr-${c.grade}`}>{c.grade}</span>}
                    </div>
                    <div className="text-[11px] mt-1 truncate" style={{ color: "var(--ink3)" }}>
                      {c.owners_display ?? "담당 미지정"}
                    </div>
                    {c.next_action && (
                      <div className="text-[11px] mt-1 truncate" style={{ color: "var(--ink2)" }}>▸ {c.next_action}</div>
                    )}
                    {c.has_breach && <div className="text-[11px] font-bold mt-1 text-bad">SLA 초과</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
