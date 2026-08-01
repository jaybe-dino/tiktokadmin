"use client";
import { useState, useTransition } from "react";
import { sendSmsAction } from "@/app/actions";

// 순수 헬퍼(클라이언트) — lib/sms 는 서버전용(env)이라 여기 인라인.
function byteLen(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.codePointAt(0)! > 0x7f ? 2 : 1;
  return n;
}
function smsType(msg: string): "SMS" | "LMS" {
  return byteLen(msg) <= 90 ? "SMS" : "LMS";
}

// 개별 문자 발송 위젯 (Aligo). 발송 센터·고객카드에서 사용.
export default function SmsSender({ brandId, defaultReceiver }: { brandId?: string; defaultReceiver?: string }) {
  const [receiver, setReceiver] = useState(defaultReceiver ?? "");
  const [msg, setMsg] = useState("");
  const [test, setTest] = useState(true);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const bytes = byteLen(msg);
  const type = smsType(msg);

  function submit() {
    start(async () => {
      const r = await sendSmsAction({ brand_id: brandId, receiver, msg, kind: "manual", test });
      setResult(r.ok ? { ok: true, text: `${r.type} 접수 완료${r.msgId ? ` (msg_id ${r.msgId})` : ""}${test ? " · 테스트모드" : ""}` } : { ok: false, text: r.error ?? "실패" });
      if (r.ok && !test) setMsg("");
    });
  }

  return (
    <div className="card">
      <div className="card-hd"><b>📱 문자 발송</b><span className="ml-auto text-[11px]" style={{ color: "var(--ink3)" }}>Aligo</span></div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label className="label">수신번호 (콤마로 여러 명)</label>
          <input className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="01012345678" />
        </div>
        <div>
          <label className="label">내용 <span style={{ color: type === "SMS" ? "var(--ink3)" : "var(--warn)" }}>· {bytes}바이트 · {type}</span></label>
          <textarea className="input" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="90바이트 이하 SMS, 초과 시 자동 LMS" />
        </div>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
          테스트 모드(실발송·과금 없음)
        </label>
        {result && <div className="note" style={{ color: result.ok ? "var(--ok)" : "var(--danger)" }}>{result.text}</div>}
        <button className="btn btn-primary" disabled={pending || !receiver || !msg} onClick={submit}>
          {pending ? "발송 중…" : "문자 발송"}
        </button>
      </div>
    </div>
  );
}
