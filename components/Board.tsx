"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { transitionAction } from "@/app/actions";
import { STATE_LABELS, type State } from "@/lib/types";
import type { BoardCard } from "@/lib/repo/queries";

const COLUMNS: State[] = [
  "lead_new", "seminar", "meeting", "contact", "contract_review",
  "contract_done", "docs", "setup", "live_mall", "live_onboarding", "settling",
];

const GRADE_COLOR: Record<string, string> = {
  S: "bg-purple-100 text-purple-700",
  A: "bg-blue-100 text-blue-700",
  B: "bg-amber-100 text-amber-700",
  C: "bg-gray-100 text-gray-600",
};

export default function Board({ cards }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [toast, setToast] = useState<{ msg: string; bad: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byState = (s: State) => cards.filter((c) => c.state === s);

  async function onDrop(to: State) {
    if (!dragId) return;
    const card = cards.find((c) => c.id === dragId);
    setDragId(null);
    if (!card || card.state === to) return;
    setBusy(true);
    const res = await transitionAction(card.id, to);
    setBusy(false);
    if (res.ok) {
      setToast({ msg: `${card.brand_name} → ${STATE_LABELS[to]}`, bad: false });
      router.refresh();
    } else {
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
                    draggable={!busy}
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
