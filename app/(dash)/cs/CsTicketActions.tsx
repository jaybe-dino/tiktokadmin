"use client";
import { useState, useTransition } from "react";
import { setTicketStatusAction, assignTicketAction, setTicketPriorityAction } from "./actions";

const PRIORITY_OPTS: { value: string; label: string }[] = [
  { value: "urgent", label: "긴급" },
  { value: "high", label: "높음" },
  { value: "normal", label: "보통" },
  { value: "low", label: "낮음" },
];

export default function CsTicketActions({
  id, status, priority, assignee,
}: {
  id: string; status: string; priority: string; assignee: string | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setMsg("");
      const r = await fn();
      if (!r.ok) setMsg(`✗ ${r.error ?? "실패"}`);
    });

  const resolved = status === "resolved" || status === "closed";

  return (
    <div className="flex items-center gap-2 flex-wrap mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
      <select
        className="input"
        style={{ width: 90, height: 30, fontSize: 12 }}
        value={priority}
        disabled={pending}
        onChange={(e) => run(() => setTicketPriorityAction(id, e.target.value))}
      >
        {PRIORITY_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {assignee ? (
        <button className="btn btn-sm" disabled={pending} onClick={() => run(() => assignTicketAction(id, false))}>
          담당: {assignee} (해제)
        </button>
      ) : (
        <button className="btn btn-sm" disabled={pending} onClick={() => run(() => assignTicketAction(id, true))}>
          나에게 배정
        </button>
      )}

      {!resolved ? (
        <>
          {status !== "in_progress" && (
            <button className="btn btn-sm" disabled={pending} onClick={() => run(() => setTicketStatusAction(id, "in_progress"))}>
              진행 중
            </button>
          )}
          <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(() => setTicketStatusAction(id, "resolved"))}>
            해결
          </button>
          <button className="btn btn-sm" disabled={pending} onClick={() => run(() => setTicketStatusAction(id, "closed"))}>
            종료
          </button>
        </>
      ) : (
        <button className="btn btn-sm" disabled={pending} onClick={() => run(() => setTicketStatusAction(id, "open"))}>
          재오픈
        </button>
      )}

      {msg && <span className="text-[11px]" style={{ color: "var(--danger)" }}>{msg}</span>}
    </div>
  );
}
