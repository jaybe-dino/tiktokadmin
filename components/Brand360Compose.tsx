"use client";

// 브랜드360 미팅·메일 탭 — 메일 직접 작성 창. 직접 쓰거나 AI로 초안 생성 후 편집 → 초안함 저장.
//   수신자: 브랜드 담당자 목록에서 선택 추가 + 직접 입력·수정(다중 수신). 저장은 초안함 경유.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewComposeAction, createManualDraftAction } from "@/app/(dash)/brand360/actions";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 수신자 영역 박스(받는사람/참조 공용) — 테두리·헤더로 구분.
function RecipientBox({
  title, badge, accent, items, onRemove, pickable, onPick, pickLabel, addValue, setAddValue, onAdd, placeholder, emptyText,
}: {
  title: string; badge: string; accent: string;
  items: string[]; onRemove: (e: string) => void;
  pickable: { name: string; email: string }[]; onPick: (email: string) => void; pickLabel: string;
  addValue: string; setAddValue: (v: string) => void; onAdd: (v: string) => void;
  placeholder: string; emptyText: string;
}) {
  return (
    <div style={{ border: "1px solid var(--line)", borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <b style={{ fontSize: 12.5 }}>{title}</b>
        <span className="chip" style={{ fontSize: 10, background: accent, color: "#fff", borderColor: accent }}>{badge}</span>
        {items.length > 0 && <span style={{ color: "var(--ink3)", fontSize: 11.5 }}>{items.length}명</span>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {items.length === 0 && <span className="note" style={{ margin: 0 }}>{emptyText}</span>}
        {items.map((e) => (
          <span key={e} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            {e}
            <button style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink3)", fontSize: 12 }} title="제외" onClick={() => onRemove(e)}>✕</button>
          </span>
        ))}
      </div>
      {pickable.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="note" style={{ margin: 0, alignSelf: "center" }}>{pickLabel}</span>
          {pickable.map((c) => (
            <button key={c.email} className="btn sm" onClick={() => onPick(c.email)} title={c.email}>+ {c.name}</button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(addValue); setAddValue(""); } }}
          placeholder={placeholder}
        />
        <button className="btn sm" onClick={() => { onAdd(addValue); setAddValue(""); }}>+ 추가</button>
      </div>
    </div>
  );
}

export default function Brand360Compose({
  brandId,
  brandEmail,
  contacts = [],
}: {
  brandId: string;
  brandEmail?: string | null;
  contacts?: { name: string; email: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<string[]>(brandEmail ? [brandEmail] : []);
  const [addEmail, setAddEmail] = useState("");
  const [cc, setCc] = useState<string[]>([]);
  const [addCc, setAddCc] = useState("");
  const [intent, setIntent] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const has = (e: string) => recipients.some((r) => r.toLowerCase() === e.toLowerCase());
  const hasCc = (e: string) => cc.some((r) => r.toLowerCase() === e.toLowerCase());
  function addRecipient(e: string) {
    const v = e.trim();
    if (!v) return;
    if (!EMAIL_RE.test(v)) { setMsg({ ok: false, text: "이메일 형식을 확인하세요." }); return; }
    if (has(v)) return;
    setRecipients((rs) => [...rs, v]);
    setMsg(null);
  }
  function removeRecipient(e: string) {
    setRecipients((rs) => rs.filter((r) => r !== e));
  }
  function addCcRecipient(e: string) {
    const v = e.trim();
    if (!v) return;
    if (!EMAIL_RE.test(v)) { setMsg({ ok: false, text: "이메일 형식을 확인하세요." }); return; }
    if (hasCc(v)) return;
    setCc((rs) => [...rs, v]);
    setMsg(null);
  }
  function removeCc(e: string) {
    setCc((rs) => rs.filter((r) => r !== e));
  }

  function reset() {
    setRecipients(brandEmail ? [brandEmail] : []); setAddEmail("");
    setCc([]); setAddCc("");
    setIntent(""); setSubject(""); setBody(""); setMsg(null);
  }

  function genAi() {
    setMsg(null);
    start(async () => {
      const r = await previewComposeAction(brandId, intent);
      if (r.ok) {
        if (r.subject) setSubject(r.subject);
        if (r.body) setBody(r.body);
        if (recipients.length === 0 && r.toEmail) setRecipients([r.toEmail]);
        setMsg({ ok: true, text: "AI 초안을 생성했습니다. 내용을 확인·수정한 뒤 저장하세요." });
      } else setMsg({ ok: false, text: r.error ?? "AI 생성 실패" });
    });
  }

  function save() {
    if (recipients.length === 0) { setMsg({ ok: false, text: "받는사람을 1명 이상 추가하세요." }); return; }
    if (!body.trim()) { setMsg({ ok: false, text: "본문을 입력하거나 AI로 생성하세요." }); return; }
    setMsg(null);
    start(async () => {
      const r = await createManualDraftAction(brandId, recipients.join(", "), subject, body, cc.join(", "));
      if (r.ok) {
        setMsg({ ok: true, text: "초안함에 저장했습니다. 아래 '메일 초안'에서 검토·발송하세요." });
        setIntent(""); setSubject(""); setBody("");
        router.refresh();
        setTimeout(() => { setOpen(false); setMsg(null); }, 1400);
      } else setMsg({ ok: false, text: r.error ?? "저장 실패" });
    });
  }

  // 아직 추가되지 않은 브랜드 담당자(이메일 기준).
  const pickable = contacts.filter((c) => !has(c.email));
  const ccPickable = contacts.filter((c) => !hasCc(c.email) && !has(c.email));

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
          {/* 받는사람 — 다중 수신, 담당자 선택 + 직접 추가·수정 */}
          {/* 받는사람(To) — 별도 박스 */}
          <RecipientBox
            title="받는사람" badge="To" accent="#2563eb"
            items={recipients} onRemove={removeRecipient}
            pickable={pickable} onPick={addRecipient} pickLabel="브랜드 담당자 추가:"
            addValue={addEmail} setAddValue={setAddEmail} onAdd={addRecipient}
            placeholder="직접 이메일 추가 (예: contact@brand.com)"
            emptyText="수신자가 없습니다 — 담당자를 추가하세요."
          />

          {/* 참조(CC) — 별도 박스 */}
          <RecipientBox
            title="참조" badge="CC" accent="#94a3b8"
            items={cc} onRemove={removeCc}
            pickable={ccPickable} onPick={addCcRecipient} pickLabel="브랜드 담당자 참조:"
            addValue={addCc} setAddValue={setAddCc} onAdd={addCcRecipient}
            placeholder="참조 이메일 직접 추가 (선택)"
            emptyText="참조 수신자 없음 (선택) — 필요 시 담당자를 추가하세요."
          />

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
