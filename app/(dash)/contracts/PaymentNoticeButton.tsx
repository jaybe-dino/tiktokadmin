"use client";
// 결제 안내 발송 버튼(계약 리스팅 행) — 발송 전 내용 확인 후 메일 발송.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewPaymentGuideAction, sendPaymentGuideAction } from "./actions";

export default function PaymentNoticeButton({ brandId, item }: { brandId: string; item: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pv, setPv] = useState<{ subject: string; body: string; hasEmail: boolean; gateReason?: string } | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  async function openPreview() {
    setErr(""); setDone(""); setPv(null); setOpen(true); setLoading(true);
    const r = await previewPaymentGuideAction(brandId, item);
    setLoading(false);
    if (r.ok && r.subject != null && r.body != null) setPv({ subject: r.subject, body: r.body, hasEmail: !!r.hasEmail, gateReason: r.gateReason });
    else setErr(r.error ?? "미리보기 실패");
  }

  function send() {
    setErr(""); setDone("");
    start(async () => {
      const r = await sendPaymentGuideAction({ brandId, item });
      if (r.ok) {
        setDone(r.sent ? "결제 안내 메일을 발송했습니다." : "발송 접수(메일 연동 미설정 — 기록만 저장).");
        router.refresh();
        setTimeout(() => setOpen(false), 1500);
      } else setErr(r.error ?? "발송 실패");
    });
  }

  return (
    <>
      <button className="btn sm" disabled={pending} onClick={openPreview} title="결제 안내 메일 발송(발송 전 내용 확인)">결제안내</button>
      {open && (
        <div onClick={() => !pending && setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card,#fff)", color: "var(--ink,#111)", borderRadius: 12, width: "min(560px, 96vw)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>결제 안내 발송 — 내용 확인</b>
              <button className="btn sm" onClick={() => !pending && setOpen(false)}>닫기</button>
            </div>
            <div style={{ padding: 16 }}>
              {loading && <div style={{ fontSize: 13, color: "var(--ink3)" }}>불러오는 중…</div>}
              {!loading && pv && (
                <>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>제목</div>
                  <div style={{ fontWeight: 700, marginBottom: 10 }}>{pv.subject}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>본문</div>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.5, background: "var(--tint,#f6f8fb)", padding: 12, borderRadius: 8, margin: 0 }}>{pv.body}</pre>
                  {!pv.hasEmail && <div className="note" style={{ marginTop: 10, color: "var(--warn)", fontSize: 12 }}>브랜드 이메일 미등록 — 발송할 수 없습니다(회사정보에서 입력).</div>}
                  {pv.gateReason && <div className="note" style={{ marginTop: 8, color: "var(--warn)", fontSize: 12 }}>발송 게이트: {pv.gateReason}</div>}
                </>
              )}
              {err && <div className="note" style={{ marginTop: 10, color: "var(--warn)", fontWeight: 700 }}>{err}</div>}
              {done && <div className="note" style={{ marginTop: 10, color: "var(--ok)", fontWeight: 700 }}>{done}</div>}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={() => !pending && setOpen(false)}>취소</button>
              <button className="btn pri" disabled={pending || loading || !pv || !pv.hasEmail} onClick={send}>{pending ? "발송 중…" : "메일 발송"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
