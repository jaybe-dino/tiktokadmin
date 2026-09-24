"use client";
// 수신거부 QA 패널 — 운영 고객을 건드리지 않고 흐름을 끝까지 확인한다.
//   합성 주소(qa+...@glovek.invalid)만 쓰며 실제 발송은 하지 않는다.
import { useState, useTransition } from "react";
import {
  qaOptoutPreviewAction, qaOptoutStatusAction, qaOptoutResetAction, qaOptoutConfirmAction,
  type QaPreview,
} from "@/app/(dash)/channels/qa-actions";

export default function AdOptoutQaPanel({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<QaPreview | null>(null);
  const [status, setStatus] = useState<{ kind: string; at: string }[] | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) => start(async () => { setMsg(""); await fn(); });

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="hd">
        <b>🧪 광고 수신거부 — QA 확인</b>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>합성 주소만 사용 · 실제 발송 없음 · 운영 고객 변경 없음</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} data-testid="qa-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : "열기"}
        </button>
      </div>
      {open && (
        <div className="bd" style={{ display: "grid", gap: 10, fontSize: 12 }}>
          <div className="note" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            실제 고객 대신 <b>존재하지 않는 합성 주소</b>(<code>qa+…@glovek.invalid</code>, <code>01000000000</code>)로
            링크를 만들어 확인합니다. 이 버튼들은 <b>문자·메일을 보내지 않습니다.</b> 확정한 기록은 QA 로 표시되며
            「정리」로 되돌릴 수 있습니다.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-primary" data-testid="qa-preview" disabled={pending || !canEdit}
              onClick={() => run(async () => {
                const r = await qaOptoutPreviewAction(
                  "[디노스튜디오·GloveK]\n예시 문자 본문입니다.",
                  "안녕하세요. 디노스튜디오 GloveK입니다.\n\n예시 메일 본문입니다.");
                if (r.ok && r.data) { setP(r.data); setStatus(null); setMsg("합성 수신자와 링크를 만들었습니다(발송 없음)."); }
                else setMsg(r.error ?? "실패");
              })}>
              1) 합성 수신자·링크 만들기
            </button>
            {p && (
              <>
                <button className="btn btn-sm" data-testid="qa-status" disabled={pending}
                  onClick={() => run(async () => {
                    const r = await qaOptoutStatusAction(p.email, p.phone);
                    if (r.ok) { setStatus(r.blocked ?? []); setMsg(`현재 차단 ${r.blocked?.length ?? 0}건`); }
                    else setMsg(r.error ?? "실패");
                  })}>
                  2) 상태 확인
                </button>
                <button className="btn btn-sm" data-testid="qa-confirm" disabled={pending || !canEdit}
                  onClick={() => run(async () => {
                    const r = await qaOptoutConfirmAction(p.email, p.phone, "phone");
                    setMsg(r.ok ? `문자 링크로 확정 처리됨${r.already ? "(이미 처리돼 있었음)" : ""} — 이제 문자·메일 모두 차단` : (r.error ?? "실패"));
                    const s = await qaOptoutStatusAction(p.email, p.phone);
                    if (s.ok) setStatus(s.blocked ?? []);
                  })}>
                  3) 문자 링크로 확정(모의)
                </button>
                <button className="btn btn-sm" data-testid="qa-reset" disabled={pending || !canEdit}
                  onClick={() => run(async () => {
                    const r = await qaOptoutResetAction(p.email, p.phone);
                    setMsg(r.ok ? `QA 기록 ${r.removed ?? 0}건 정리됨` : (r.error ?? "실패"));
                    setStatus([]);
                  })}>
                  4) 정리(되돌리기)
                </button>
              </>
            )}
          </div>

          {p && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--ink3)" }}>
                합성 수신자 · 메일 <code>{p.email}</code> · 문자 <code>{p.phone}</code>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 3 }}>문자에 붙는 모습</div>
                <pre data-testid="qa-sms" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11.5, lineHeight: 1.7,
                  background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, margin: 0 }}>{p.smsBody}</pre>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 3 }}>메일에 붙는 모습</div>
                <pre data-testid="qa-mail" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11.5, lineHeight: 1.7,
                  background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: 10, margin: 0 }}>{p.mailBody}</pre>
              </div>
              <div style={{ fontSize: 11.5 }}>
                수신거부 페이지 열기(합성 주소 — 눌러도 실제 고객과 무관):{" "}
                <a data-testid="qa-link" href={p.smsUrl} target="_blank" rel="noreferrer" style={{ color: "#1971c2", wordBreak: "break-all" }}>{p.smsUrl}</a>
              </div>
            </div>
          )}

          {status && (
            <div data-testid="qa-status-out" style={{ fontSize: 11.5, color: status.length ? "#c25400" : "var(--ink3)" }}>
              {status.length === 0 ? "차단 없음(광고 발송 가능 상태)"
                : `차단됨 — ${status.map((s) => (s.kind === "email" ? "메일" : "문자")).join("·")} · ${status[0].at.slice(0, 16).replace("T", " ")}`}
            </div>
          )}
          {msg && <div data-testid="qa-msg" style={{ fontSize: 12, color: "var(--ink2)" }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
