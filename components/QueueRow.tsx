"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { logContactAction, setNextActionAction } from "@/app/actions";
import { StateBadge, GradeBadge } from "@/components/badges";
import type { BoardCard } from "@/lib/repo/queries";

export default function QueueRow({ card }: { card: BoardCard }) {
  const router = useRouter();
  const [next, setNext] = useState(card.next_action);
  const [due, setDue] = useState(card.due_date ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <div className={`card p-3 flex items-center gap-3 ${card.has_breach ? "ring-1 ring-bad" : ""}`}>
      <div className="w-48 shrink-0">
        <Link href={`/brand/${card.id}`} className="font-semibold text-sm hover:text-pink">
          {card.brand_name}
        </Link>
        <div className="flex gap-1 mt-1">
          <StateBadge state={card.state} />
          <GradeBadge grade={card.grade} />
          {card.has_breach && <span className="pill bg-red-100 text-bad">SLA</span>}
        </div>
      </div>
      <input
        className="input flex-1"
        placeholder="다음 액션"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <input className="input w-36" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <button
        className="btn"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          await setNextActionAction(card.id, next, due || undefined);
          setSaving(false);
          router.refresh();
        }}
      >
        저장
      </button>
      <button
        className="btn btn-primary"
        onClick={async () => {
          await logContactAction(card.id, "call", "워크큐 완료");
          router.refresh();
        }}
      >
        접촉완료
      </button>
    </div>
  );
}
