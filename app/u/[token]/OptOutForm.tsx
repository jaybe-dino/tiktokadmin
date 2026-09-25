"use client";
// 수신거부 확정 버튼 — 한 번 누르면 POST 로 확정된다(로그인·사유 입력 없음).
import { useState, useTransition } from "react";
import { confirmOptOutAction } from "./actions";
import { adScopeNotice, adAllRoundsNotice, AD_SCOPE_ALSO_OTHER } from "@/lib/ad-optout-copy";

export default function OptOutForm({ token }: { token: string }) {
  const [done, setDone] = useState<null | { already?: boolean }>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div data-testid="optout-done" style={{ border: "1px solid #b7e3c8", background: "#f2fbf5", borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#0b7a52" }}>
          {done.already ? "이미 수신거부 처리되어 있습니다." : "광고 수신거부가 완료되었습니다."}
        </div>
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 14, lineHeight: 1.8, color: "#245" }}>
          <li><b>광고 문자·메일은 더 이상 보내지 않습니다.</b> 문자와 메일 모두 중단됩니다.</li>
          <li data-testid="optout-done-scope">{adScopeNotice()} <b>{adAllRoundsNotice()}</b></li>
          <li>{AD_SCOPE_ALSO_OTHER}</li>
          <li>이미 발송 처리된 건은 회수되지 않아 <b>한두 건이 더 도착할 수 있습니다.</b></li>
        </ul>
        <div style={{ marginTop: 12, fontSize: 12.5, color: "#5a6b7b" }}>이 창은 닫으셔도 됩니다.</div>
      </div>
    );
  }

  return (
    <div>
      <button data-testid="optout-confirm" disabled={pending}
        onClick={() => start(async () => {
          setErr("");
          const r = await confirmOptOutAction(token);
          if (r.ok) setDone({ already: r.already });
          else setErr(r.error ?? "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        })}
        style={{
          width: "100%", padding: "16px 18px", fontSize: 16, fontWeight: 800, cursor: pending ? "default" : "pointer",
          borderRadius: 12, border: "none", background: pending ? "#9aa5b1" : "#1f2937", color: "#fff",
        }}>
        {pending ? "처리 중…" : "광고 문자·메일 수신거부"}
      </button>
      {err && (
        <div data-testid="optout-error" style={{ marginTop: 10, color: "#c92a2a", fontSize: 13.5, lineHeight: 1.6 }}>
          {err}
        </div>
      )}
    </div>
  );
}
