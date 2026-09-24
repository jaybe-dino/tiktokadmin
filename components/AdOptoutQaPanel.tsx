"use client";
// 광고 수신거부 QA 패널 — 운영 고객을 건드리지 않고 흐름을 끝까지 확인한다.
//   서버가 만든 합성 수신자(qa+…@glovek.invalid, 전화 없음)만 대상으로 하며,
//   화면은 주소를 보내지 않고 서버가 준 토큰만 되돌려준다. 실제 발송·기록 삭제는 없다.
import { useState, useTransition } from "react";
import {
  qaOptoutFixtureAction, qaOptoutStatusAction, qaOptoutConfirmAction, type QaFixture,
} from "@/app/(dash)/channels/qa-actions";

export default function AdOptoutQaPanel({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [fx, setFx] = useState<QaFixture | null>(null);
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<void>) => start(async () => { setMsg(""); await fn(); });

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="hd">
        <b>🧪 광고 수신거부 — QA 확인</b>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>합성 수신자만 · 실제 발송 없음 · 운영 고객 변경 없음</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} data-testid="qa-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : "열기"}
        </button>
      </div>
      {open && (
        <div className="bd" style={{ display: "grid", gap: 10, fontSize: 12 }}>
          <div className="note" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            서버가 <b>존재할 수 없는 합성 주소</b>(<code>qa+…@glovek.invalid</code>, 전화번호 없음)로 수신자를 만들어
            확인합니다. 화면에서 주소를 바꿔 넣을 수 없고, 실제 고객·실제 발송과 무관합니다.
            확정 기록은 QA 로 남으며 이 화면에 삭제 기능은 없습니다.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-primary" data-testid="qa-fixture" disabled={pending || !canEdit}
              onClick={() => run(async () => {
                const r = await qaOptoutFixtureAction();
                if (r.ok && r.data) { setFx(r.data); setBlocked(null); setMsg("합성 수신자와 링크를 만들었습니다(발송 없음)."); }
                else setMsg(r.error ?? "실패");
              })}>
              1) 합성 수신자·링크 만들기
            </button>
            {fx && (
              <>
                <button className="btn btn-sm" data-testid="qa-status" disabled={pending}
                  onClick={() => run(async () => {
                    const r = await qaOptoutStatusAction(fx.token);
                    if (r.ok) { setBlocked(Boolean(r.blocked)); setMsg(r.blocked ? "차단됨 — 광고 발송 불가" : "차단 없음 — 광고 발송 가능"); }
                    else setMsg(r.error ?? "실패");
                  })}>
                  2) 상태 확인
                </button>
                <button className="btn btn-sm" data-testid="qa-confirm" disabled={pending || !canEdit}
                  onClick={() => run(async () => {
                    const r = await qaOptoutConfirmAction(fx.token);
                    setMsg(r.ok ? `확정 처리됨${r.already ? "(이미 처리돼 있었음)" : ""}` : (r.error ?? "실패"));
                    const s = await qaOptoutStatusAction(fx.token);
                    if (s.ok) setBlocked(Boolean(s.blocked));
                  })}>
                  3) 수신거부 확정(모의)
                </button>
              </>
            )}
          </div>

          {fx && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--ink3)" }}>합성 수신자 · 메일 <code>{fx.emailMasked}</code> · 전화 없음</div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 3 }}>문자에 붙는 모습</div>
                <pre data-testid="qa-sms" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11.5, lineHeight: 1.7,
                  background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, margin: 0 }}>{fx.smsBody}</pre>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 3 }}>메일에 붙는 모습</div>
                <pre data-testid="qa-mail" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11.5, lineHeight: 1.7,
                  background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, margin: 0 }}>{fx.mailBody}</pre>
              </div>
              <div style={{ fontSize: 11.5 }}>
                수신거부 페이지 열기(합성 주소 — 실제 고객과 무관):{" "}
                <a data-testid="qa-link" href={fx.url} target="_blank" rel="noreferrer" style={{ color: "#1971c2", wordBreak: "break-all" }}>{fx.url}</a>
              </div>
            </div>
          )}

          {blocked !== null && (
            <div data-testid="qa-status-out" style={{ fontSize: 11.5, color: blocked ? "#c25400" : "var(--ink3)" }}>
              {blocked ? "🚫 이 합성 수신자는 광고 차단 상태입니다." : "광고 발송 가능 상태입니다."}
            </div>
          )}
          {msg && <div data-testid="qa-msg" style={{ fontSize: 12, color: "var(--ink2)" }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
