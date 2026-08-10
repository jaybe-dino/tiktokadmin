"use client";
// 운영 견적서 발송 버튼 — 리스팅에서 발송 전 내용을 확인하고 메일(문자 선택) 발송.
//   메일이 기본(항상), "문자 안내도 발송" 체크 시 문자도 함께 나간다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { opsProposalPreviewAction, sendOpsProposalAction } from "./actions";

export default function OpsSendButton({ id, label = "발송" }: { id: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string; hasEmail: boolean; hasPhone: boolean } | null>(null);
  const [smsNotice, setSmsNotice] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  async function openPreview() {
    setErr("");
    setDone("");
    setPreview(null);
    setSmsNotice(false);
    setOpen(true);
    setLoading(true);
    const r = await opsProposalPreviewAction(id);
    setLoading(false);
    if (r.ok && r.subject != null && r.body != null) {
      setPreview({ subject: r.subject, body: r.body, hasEmail: !!r.hasEmail, hasPhone: !!r.hasPhone });
    } else {
      setErr(r.error ?? "미리보기 실패");
    }
  }

  function send() {
    setErr("");
    setDone("");
    start(async () => {
      const r = await sendOpsProposalAction(id, { sendSmsNotice: smsNotice });
      if (r.ok) {
        const bits = [r.sentEmail ? "메일 발송됨" : null, r.sentSms ? "문자 발송됨" : null].filter(Boolean).join(" · ");
        setDone((bits || "발송 처리됨") + (r.note ? ` (${r.note})` : ""));
        router.refresh();
        // 잠시 후 닫기 — 결과 확인 시간 확보.
        setTimeout(() => setOpen(false), 1600);
      } else {
        setErr(r.error ?? "발송 실패");
      }
    });
  }

  return (
    <>
      <button className="btn sm pri" disabled={pending} onClick={openPreview}>{label}</button>

      {open && (
        <div
          onClick={() => !pending && setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--card,#fff)", color: "var(--ink,#111)", borderRadius: 12, width: "min(560px, 96vw)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
          >
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>발송 전 내용 확인</b>
              <button className="btn sm" onClick={() => !pending && setOpen(false)}>닫기</button>
            </div>
            <div style={{ padding: 16 }}>
              {loading && <div style={{ fontSize: 13, color: "var(--ink3)" }}>불러오는 중…</div>}
              {!loading && preview && (
                <>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>제목</div>
                  <div style={{ fontWeight: 700, marginBottom: 10 }}>{preview.subject}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>본문</div>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.5, background: "var(--tint,#f6f8fb)", padding: 12, borderRadius: 8, margin: 0 }}>{preview.body}</pre>

                  {!preview.hasEmail && (
                    <div className="note" style={{ marginTop: 10, color: "var(--warn)", fontSize: 12 }}>
                      담당자 이메일 미등록 — 메일이 발송되지 않습니다(회사정보에서 입력).
                    </div>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, opacity: preview.hasPhone ? 1 : 0.55 }}>
                    <input type="checkbox" checked={smsNotice} disabled={!preview.hasPhone} onChange={(e) => setSmsNotice(e.target.checked)} />
                    문자 안내도 발송{!preview.hasPhone ? " (전화번호 미등록)" : ""}
                  </label>
                  <div className="note" style={{ marginTop: 4, fontSize: 11 }}>메일은 기본 발송됩니다. 문자는 체크 시에만 함께 발송됩니다.</div>
                </>
              )}

              {err && <div className="note" style={{ marginTop: 10, color: "var(--warn)", fontWeight: 700 }}>{err}</div>}
              {done && <div className="note" style={{ marginTop: 10, color: "var(--ok)", fontWeight: 700 }}>{done}</div>}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={() => !pending && setOpen(false)}>취소</button>
              <button className="btn pri" disabled={pending || loading || !preview || !preview.hasEmail} onClick={send}>
                {pending ? "발송 중…" : smsNotice ? "메일+문자 발송" : "메일 발송"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
