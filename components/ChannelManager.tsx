"use client";
// 유입 채널(주제별 키) 관리 — Zapier/외부 DB 가 채널 키로 POST → 채널별 문자·메일/토글.
//   각 채널: 전용 POST URL(복사) · 실시간 on/off · 문자·메일 템플릿.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChannelAction, updateChannelAction, deleteChannelAction } from "@/app/actions";
import type { IntakeChannel } from "@/lib/intake-channels";

const SOURCE_OPTS: [string, string][] = [
  ["meta_ads", "메타/페북 광고"], ["expo", "전시/팝업"], ["referrer", "영업 직접"],
  ["tp_seminar", "세미나"], ["tp_ebook", "전자책"], ["etc", "기타"],
];

function originOf(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://tiktokadmin.vercel.app";
}

export default function ChannelManager({ channels, canEdit }: { channels: IntakeChannel[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openAdd, setOpenAdd] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("meta_ads");
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const toggle = (c: IntakeChannel, field: "enabled" | "send_sms" | "send_email") =>
    start(async () => {
      await updateChannelAction(c.id, { [field]: !c[field] } as Partial<IntakeChannel>);
      router.refresh();
    });

  const copyUrl = (key: string) => {
    const url = `${originOf()}/api/leadhook?key=${key}`;
    navigator.clipboard?.writeText(url).then(() => { setMsg("POST URL 복사됨"); setTimeout(() => setMsg(""), 1500); });
  };

  return (
    <div className="card">
      <div className="card-hd">
        <b>유입 채널 — 주제별 키 · 자동 문자·메일</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>Zapier/외부 DB POST · {channels.length}개</span>
        {canEdit && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenAdd((v) => !v)}>{openAdd ? "닫기" : "+ 채널 추가"}</button>}
      </div>

      {openAdd && canEdit && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label className="label">채널명(주제)</label><input className="input" style={{ width: 200 }} placeholder="예: 메타 뷰티 리드 / 9월 세미나" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label">유입 소스</label>
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" disabled={pending || !name.trim()} onClick={() => start(async () => {
            const r = await createChannelAction({ name, source });
            if (r.ok) { setName(""); setOpenAdd(false); router.refresh(); }
            else setMsg(r.error ?? "실패");
          })}>{pending ? "생성 중…" : "생성"}</button>
        </div>
      )}

      <div style={{ padding: "6px 0" }}>
        {channels.length === 0 && <div style={{ padding: "16px", color: "var(--ink3)", fontSize: 13 }}>등록된 채널이 없습니다. 채널을 만들면 전용 POST URL 이 생기고, Zapier/외부 DB 를 그 URL 로 연결하면 됩니다.</div>}
        {channels.map((c) => (
          <div key={c.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <b>{c.name}</b>
              <span className="pill" style={{ fontSize: 10 }}>{SOURCE_OPTS.find(([v]) => v === c.source)?.[1] ?? c.source}</span>
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>유입 {c.lead_count}건{c.last_lead_at ? ` · 최근 ${new Date(c.last_lead_at).toLocaleString("ko-KR")}` : ""}</span>
              <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => copyUrl(c.key)} title="이 채널 전용 POST URL 복사">📋 POST URL</button>
              {canEdit && <button className="btn btn-sm" onClick={() => setEditId(editId === c.id ? null : c.id)}>{editId === c.id ? "접기" : "✏️ 내용"}</button>}
              {canEdit && <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { if (confirm(`'${c.name}' 채널 삭제?`)) { await deleteChannelAction(c.id); router.refresh(); } })}>삭제</button>}
            </div>

            {/* 실시간 토글 */}
            <div style={{ display: "flex", gap: 16, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span className={`tgl ${c.enabled ? "on" : ""}`} onClick={() => canEdit && toggle(c, "enabled")} /> 자동발송 {c.enabled ? "ON" : "OFF(유입만)"}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, opacity: c.enabled ? 1 : 0.45 }}>
                <span className={`tgl ${c.send_sms ? "on" : ""}`} onClick={() => canEdit && c.enabled && toggle(c, "send_sms")} /> 문자
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, opacity: c.enabled ? 1 : 0.45 }}>
                <span className={`tgl ${c.send_email ? "on" : ""}`} onClick={() => canEdit && c.enabled && toggle(c, "send_email")} /> 메일
              </label>
            </div>

            {editId === c.id && canEdit && <ChannelEditor channel={c} onSaved={() => { setEditId(null); router.refresh(); }} />}
          </div>
        ))}
      </div>

      <div className="note" style={{ margin: "8px 16px 14px" }}>
        각 채널마다 <b>전용 POST URL</b>(주제별 키)이 있어, Zapier·외부 DB 를 그 URL 로 연결하면 그 채널의 <b>문자·메일 내용</b>으로 자동 발송됩니다.
        <b> 자동발송 토글</b>로 실시간 on/off (OFF 여도 리드 유입·기록은 유지). 문자·메일 <b>템플릿</b>은 <code>{"{브랜드명}"}</code> <code>{"{담당자명}"}</code> 치환.
      </div>
      {msg && <div className="note" style={{ margin: "0 16px 10px", color: "var(--ok)" }}>{msg}</div>}
    </div>
  );
}

function ChannelEditor({ channel, onSaved }: { channel: IntakeChannel; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const [sms, setSms] = useState(channel.sms_template);
  const [subj, setSubj] = useState(channel.email_subject);
  const [body, setBody] = useState(channel.email_body);
  const [msg, setMsg] = useState("");

  return (
    <div style={{ marginTop: 10, padding: 10, background: "var(--bg)", borderRadius: 8, display: "grid", gap: 8 }}>
      <div>
        <label className="label">문자 내용 (SMS/LMS)</label>
        <textarea className="input" rows={2} style={{ width: "100%" }} value={sms} onChange={(e) => setSms(e.target.value)} placeholder="{브랜드명}님, GloveK 입니다. 문의 감사합니다 — 담당자가 곧 연락드립니다." />
      </div>
      <div>
        <label className="label">메일 제목</label>
        <input className="input" style={{ width: "100%" }} value={subj} onChange={(e) => setSubj(e.target.value)} placeholder="[GloveK] {브랜드명}님 문의 감사합니다" />
      </div>
      <div>
        <label className="label">메일 본문</label>
        <textarea className="input" rows={4} style={{ width: "100%" }} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"{담당자명}님, 안녕하세요. GloveK 입니다.\n문의 주셔서 감사합니다 — 곧 담당자가 상세 안내드리겠습니다."} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => {
          const r = await updateChannelAction(channel.id, { sms_template: sms, email_subject: subj, email_body: body });
          if (r.ok) onSaved(); else setMsg(r.error ?? "실패");
        })}>{pending ? "저장 중…" : "내용 저장"}</button>
        {msg && <span style={{ color: "var(--bad)", fontSize: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
