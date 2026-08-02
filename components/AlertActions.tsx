"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { snoozeAction } from "@/app/actions";
import { resolveAlertAction } from "@/app/(dash)/monitor/actions";

export default function AlertActions({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
      <button
        className="btn text-xs py-1"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            await snoozeAction(alertId);
            router.refresh();
          })
        }
      >
        1일 스누즈
      </button>
      <button
        className="btn text-xs py-1"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await resolveAlertAction(alertId);
            if (!r.ok) {
              setErr(r.error ?? "실패");
              return;
            }
            router.refresh();
          })
        }
      >
        해소
      </button>
      {err && <span className="pill" style={{ color: "var(--danger)" }}>{err}</span>}
    </div>
  );
}
