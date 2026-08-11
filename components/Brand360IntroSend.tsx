"use client";
// 브랜드360 '소개자료 보내기' — 클릭 시 문자/이메일 체크 + 발송 내용 미리보기 + 발송하기.
//   내용은 설정(intro_config)에서 관리. 연락처 없거나 발송 미설정이면 해당 채널 비활성.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewIntroAction, sendIntroAction } from "@/app/actions";
import type { IntroPreview } from "@/lib/intro";

export default function Brand360IntroSend({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [pv, setPv] = useState<IntroPreview | null>(null);
  const [useSms, setUseSms] = useState(true);
  const [useEmail, setUseEmail] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function openModal() {
    setMsg(null);
    setOpen(true);
    start(async () => {
      const r = await previewIntroAction(brandId);
      if (r.ok && r.preview) {
        setPv(r.preview);
        // 설정 기본 채널 + 연락처 있는 채널만 기본 체크
        setUseSms(r.preview.send_sms && !!r.preview.phone);
        setUseEmail(r.preview.send_email && !!r.preview.email);
      } else {
        setMsg({ text: r.error ?? "미리보기 실패", ok: false });
      }
    });
  }

  function send() {
    setMsg(null);
    start(async () => {
      const r = await sendIntroAction(brandId, { sms: useSms, email: useEmail });
      if (r.ok) {
        setMsg({ text: `발송 완료: ${(r.sent ?? []).map((s) => (s === "sms" ? "문자" : "이메일")).join("·")}${r.errors?.length ? ` (일부 실패: ${r.errors.join(", ")})` : ""}`, ok: true });
        router.refresh();
      } else {
        setMsg({ text: r.error ?? "발송 실패", ok: false });
      }
    });
  }

  return (
    <>
      <button className="btn" onClick={openModal}>📮 소개자료 보내기</button>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto" }}>
            <div className="hd" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 13 }}>소개자료 보내기 {pv ? `· ${pv.brand_name}` : ""}</b>
              <button className="btn sm" onClick={() => setOpen(false)}>닫기</button>
            </div>
            <div className="bd" style={{ display: "grid", gap: 12, fontSize: 12.5 }}>
              {pending && !pv ? (
                <div className="note">미리보기 불러오는 중…</div>
              ) : pv ? (
                <>
                  {/* 채널 선택 */}
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: pv.phone ? 1 : 0.5 }}>
                      <input type="checkbox" checked={useSms} disabled={!pv.phone} onChange={(e) => setUseSms(e.target.checked)} />
                      문자(SMS) {pv.phone ? <span style={{ color: "var(--ink3)" }}>→ {pv.phone}</span> : <span style={{ color: "var(--danger)" }}>연락처 없음</span>}
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: pv.email ? 1 : 0.5 }}>
                      <input type="checkbox" checked={useEmail} disabled={!pv.email} onChange={(e) => setUseEmail(e.target.checked)} />
                      이메일 {pv.email ? <span style={{ color: "var(--ink3)" }}>→ {pv.email}</span> : <span style={{ color: "var(--danger)" }}>주소 없음</span>}
                    </label>
                  </div>

                  {/* 미리보기(예시) */}
                  {useSms && (
                    <div>
                      <div className="label">문자 내용(예시)</div>
                      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, background: "#fafbfd", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{pv.sms}</div>
                    </div>
                  )}
                  {useEmail && (
                    <div>
                      <div className="label">이메일 내용(예시)</div>
                      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, background: "#fafbfd" }}>
                        <div style={{ fontWeight: 700, marginBottom: 6, borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>제목: {pv.subject}</div>
                        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{pv.body}</div>
                      </div>
                    </div>
                  )}

                  <div className="note">내용은 <b>설정 → 소개자료 발송</b>에서 관리합니다. 발송 시 접촉 기록이 남습니다.</div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button className="btn pri" disabled={pending || (!useSms && !useEmail)} onClick={send}>
                      {pending ? "발송 중…" : "발송하기"}
                    </button>
                    {msg && <span className="note" style={{ color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</span>}
                  </div>
                </>
              ) : (
                msg && <div className="note" style={{ color: "var(--danger)" }}>{msg.text}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
