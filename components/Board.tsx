"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { transitionAction } from "@/app/actions";
import { STATE_LABELS, type State } from "@/lib/types";
import type { BoardCard } from "@/lib/repo/queries";

const COLUMNS: State[] = [
  "inquiry", "seminar", "expo", "meeting", "contact",
  "contract_review", "contract_done", "setup", "live", "settling",
];

const GRADE_COLOR: Record<string, string> = {
  S: "bg-purple-100 text-purple-700",
  A: "bg-blue-100 text-blue-700",
  B: "bg-amber-100 text-amber-700",
  C: "bg-gray-100 text-gray-600",
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
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((s) => {
          const list = byState(s);
          const breaches = list.filter((c) => c.has_breach).length;
          return (
            <div
              key={s}
              className="w-64 shrink-0"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(s)}
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-sm font-bold">{STATE_LABELS[s]}</span>
                <span className="text-xs text-muted">
                  {list.length}
                  {breaches > 0 && <span className="text-bad font-bold"> · {breaches}⚠</span>}
                </span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {list.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    className={`card p-3 cursor-grab active:cursor-grabbing ${
                      c.has_breach ? "ring-1 ring-bad" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/brand/${c.id}`} className="font-semibold text-sm hover:text-pink truncate">
                        {c.brand_name}
                      </Link>
                      {c.grade && (
                        <span className={`pill ${GRADE_COLOR[c.grade]}`}>{c.grade}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted mt-1 truncate">
                      {c.owners_display ?? "담당 미지정"}
                    </div>
                    {c.next_action && (
                      <div className="text-[11px] text-ink mt-1 truncate">▸ {c.next_action}</div>
                    )}
                    {c.has_breach && <div className="text-[11px] text-bad font-bold mt-1">SLA 초과</div>}
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
