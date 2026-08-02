"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ApprovalActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "approved" | "rejected">("");
  const [err, setErr] = useState<string>("");

  async function decide(decision: "approved" | "rejected") {
    setErr("");
    setBusy(decision);
    try {
      const res = await fetch("/api/ops/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setErr(
          res.status === 403
            ? "결재 권한이 없습니다 (lead·exec)"
            : data.error === "not_pending"
              ? "이미 처리된 요청입니다"
              : "처리 실패",
        );
        setBusy("");
        return;
      }
      router.refresh();
    } catch {
      setErr("네트워크 오류");
      setBusy("");
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {err && <span className="text-[11px]" style={{ color: "var(--danger)" }}>{err}</span>}
      <button className="btn sm grn" disabled={!!busy} onClick={() => decide("approved")}>
        {busy === "approved" ? "처리중…" : "승인"}
      </button>
      <button className="btn sm dgr" disabled={!!busy} onClick={() => decide("rejected")}>
        {busy === "rejected" ? "처리중…" : "반려"}
      </button>
    </div>
  );
}
