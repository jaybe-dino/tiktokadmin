"use client";

import { useState } from "react";

type Kind = "draft" | "send";

// 세그먼트별 [AI 초안]/[발송] 액션 — 자체 API POST /api/ops/bulk-send 호출
// body {segment, channel} → {ok, queued}. API 미구현 시 "준비 중" 처리(클릭 가능).
export default function CampaignActions({
  segment,
  channel = "email",
  primary = false,
}: {
  segment: string;
  channel?: string;
  primary?: boolean;
}) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 3200);
  }

  async function run(kind: Kind) {
    if (busy) return;
    setBusy(kind);
    try {
      const res = await fetch("/api/ops/bulk-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segment, channel, kind }),
      });

      if (res.status === 404 || res.status === 405 || res.status === 501) {
        flash("발송 기능 준비 중입니다.", false);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        queued?: number;
        error?: string;
      };

      if (res.ok && data.ok) {
        const n = Number(data.queued ?? 0);
        flash(kind === "draft" ? `AI 초안 요청 완료 (${n}건 대상)` : `발송 예약 완료 · ${n}건`, true);
      } else {
        flash(data.error ? `실패: ${data.error}` : "발송 기능 준비 중입니다.", false);
      }
    } catch {
      flash("발송 기능 준비 중입니다.", false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <span style={{ whiteSpace: "nowrap", position: "relative" }}>
      <button className="btn btn-sm" disabled={busy !== null} onClick={() => run("draft")}>
        {busy === "draft" ? "생성 중…" : "AI 초안"}
      </button>{" "}
      <button
        className={`btn btn-sm${primary ? " btn-primary" : ""}`}
        disabled={busy !== null}
        onClick={() => run("send")}
      >
        {busy === "send" ? "발송 중…" : "발송"}
      </button>
      {toast && (
        <span
          className="pill"
          style={{
            marginLeft: 8,
            fontSize: 11,
            color: toast.ok ? "var(--ok)" : "var(--warn)",
            fontWeight: 700,
          }}
        >
          {toast.msg}
        </span>
      )}
    </span>
  );
}
