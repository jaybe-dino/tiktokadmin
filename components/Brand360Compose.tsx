"use client";

// 브랜드360 미팅·메일 탭 — 메일 직접 작성 창. 직접 쓰거나 AI로 초안 생성 후 편집 → 초안함 저장.
//   저장된 초안은 아래 '팔로업 메일 초안' 카드에서 검토·발송(승인 게이트 경유).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewComposeAction, createManualDraftAction } from "@/app/(dash)/brand360/actions";

export default function Brand360Compose({
  brandId,
  brandEmail,
}: {
  brandId: string;
  brandEmail?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(brandEmail ?? "");
  const [intent, setIntent] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function reset() {
    setTo(brandEmail ?? ""); setIntent(""); setSubject(""); setBody(""); setMsg(null);
  }

  function genAi() {
    setMsg(null);
    start(async () => {
      const r = await previewComposeAction(brandId, intent);
      if (r.ok) {
        if (r.subject) setSubject(r.subject);
        if (r.body) setBody(r.body);
        if (!to && r.toEmail) setTo(r.toEmail);
        setMsg({ ok: true, text: "AI 초안을 생성했습니다. 내용을 확인·수정한 뒤 저장하세요." });
      } else setMsg({ ok: false, text: r.error ?? "AI 생성 실패" });
    });
  }

  function save() {
    if (!body.trim()) { setMsg({ ok: false, text: "본문을 입력하거나 AI로 생성하세요." }); return; }
    setMsg(null);
    start(async () => {
      const r = await createManualDraftAction(brandId, to, subject, body);
      if (r.ok) {
        setMsg({ ok: true, text: "초안함에 저장했습니다. 아래 '메일 초안'에서 검토·발송하세요." });
        setIntent(""); setSubject(""); setBody("");
        router.refresh();
        setTimeout(() => { setOpen(false); setMsg(null); }, 1400);
      } else setMsg({ ok: false, text: r.error ?? "저장 실패" });
    });
  }

  return (
    <div className="card">
      <div className="hd" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b>✉️ 메일 작성</b>
        <button className="btn sm pri" onClick={() => { setOpen((o) => !o); if (!open) reset(); }}>
          {open ? "닫기" : "새 메일 작성"}
        </button>
      </div>

      {open && (
        <div className="bd" style={{ display: "grid", gap: 8 }}>
          <div>
            <label className="label">받는사람</label>
            <input className="input" style={{ width: "100%" }} value={to} onChange={(e) => setTo(e.target.value)} placeholder="받는사람 이메일 (비우면 원장 이메일)" />
          </div>

          <div style={{ background: "#f6f7fb", border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
            <label className="label" style={{ margin: 0 }}>🤖 AI로 초안 생성 (선택) — 지시사항을 적고 생성</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ flex: 1, minWidth: 180 }}
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="예: 제안 팔로업 / 서류 재요청 / 미팅 감사 인사 (비우면 현재 단계 자동 판단)"
              />
              <button className="btn sm pri" disabled={pending} onClick={genAi}>{pending ? "생성 중…" : "AI로 생성"}</button>
            </div>
            <span className="note" style={{ margin: 0 }}>브랜드 카드·최근 메일·회의록 맥락을 반영해 초안을 만들어요. 생성 후 직접 수정 가능합니다.</span>
          </div>

          <div>
            <label className="label">제목</label>
            <input className="input" style={{ width: "100%" }} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="메일 제목" />
          </div>
          <div>
            <label className="label">본문 (직접 작성 가능)</label>
            <textarea className="input" rows={10} style={{ width: "100%" }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="메일 본문을 직접 작성하거나, 위 'AI로 생성'으로 초안을 채운 뒤 수정하세요." />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={save}>{pending ? "저장 중…" : "초안함에 저장"}</button>
            {msg && <span className="note" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)", fontWeight: 600 }}>{msg.text}</span>}
          </div>
          <span className="note" style={{ margin: 0 }}>저장하면 아래 <b>메일 초안</b>에 등록되어, 검토 후 발송(승인 게이트)됩니다.</span>
        </div>
      )}
    </div>
  );
}
