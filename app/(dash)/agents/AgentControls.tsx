"use client";
import { useState, useTransition } from "react";
import { runAgentAction, toggleAgentAction } from "@/app/actions";

export default function AgentControls({ agentKey, enabled }: { agentKey: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`tgl ${on ? "on" : ""}`} onClick={() => start(async () => {
        const r = await toggleAgentAction(agentKey, !on);
        if (r.ok) setOn(!on); else setMsg(r.error ?? "실패");
      })} title={on ? "켜짐" : "꺼짐"} />
      <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
        setMsg("");
        const r = await runAgentAction(agentKey);
        setMsg(r.ok ? `✓ ${r.summary ?? "실행됨"}` : `✗ ${r.error}`);
      })}>{pending ? "실행 중…" : "지금 실행"}</button>
      {msg && <span className="text-[11px]" style={{ color: msg.startsWith("✓") ? "var(--ok)" : "var(--danger)" }}>{msg}</span>}
    </div>
  );
}
