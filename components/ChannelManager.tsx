"use client";
// 유입 채널(주제별 키) 관리 — Zapier/외부 DB 가 채널 키로 POST → 채널별 문자·메일/토글.
//   각 채널: 전용 POST URL(복사) · 실시간 on/off · 문자·메일 템플릿.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChannelAction, updateChannelAction, deleteChannelAction } from "@/app/actions";
import type { IntakeChannel, ChannelSend } from "@/lib/intake-channels";

const SOURCE_OPTS: [string, string][] = [
  ["meta_ads", "메타/페북 광고"], ["expo", "전시/팝업"], ["referrer", "영업 직접"],
  ["tp_seminar", "세미나"], ["tp_ebook", "전자책"], ["etc", "기타"],
];

function originOf(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://tiktokadmin.vercel.app";
}

export default function ChannelManager({ channels, canEdit, sends = {}, sendCounts = {} }: {
  channels: IntakeChannel[]; canEdit: boolean;
  sends?: Record<string, ChannelSend[]>; sendCounts?: Record<string, { sms: number; email: number }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openAdd, setOpenAdd] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("meta_ads");
  const [editId, setEditId] = useState<string | null>(null);
  const [histId, setHistId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const toggle = (c: IntakeChannel, field: "enabled" | "send_sms" | "send_email" | "test_mode") =>
    start(async () => {
      await updateChannelAction(c.id, { [field]: !c[field] } as Partial<IntakeChannel>);
      router.refresh();
    });

  const copyUrl = (key: string) => {
    // 2-키: key=전역 Vercel 시크릿(직접 채워넣기) + source=이 소스 id 키.
    const url = `${originOf()}/api/leadhook?key=<VERCEL_KEY>&source=${key}`;
    navigator.clipboard?.writeText(url).then(() => { setMsg("POST URL 복사됨 — <VERCEL_KEY>를 실제 값으로 교체하세요"); setTimeout(() => setMsg(""), 2500); });
  };

  return (
    <div className="card">
      <div className="card-hd">
        <b>자동발송 허용 유입 소스 — 키 관리</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>체크된 소스만 자동발송 · {channels.length}개</span>
        {canEdit && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenAdd((v) => !v)}>{openAdd ? "닫기" : "+ 소스 추가"}</button>}
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
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>
                유입 {c.lead_count}건 · 발송 문자 {sendCounts[c.id]?.sms ?? 0}·메일 {sendCounts[c.id]?.email ?? 0}
                {c.last_lead_at ? ` · 최근 ${new Date(c.last_lead_at).toLocaleString("ko-KR")}` : ""}
              </span>
              <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => copyUrl(c.key)} title="이 채널 전용 POST URL 복사">📋 POST URL</button>
              <button className="btn btn-sm" onClick={() => setHistId(histId === c.id ? null : c.id)}>{histId === c.id ? "접기" : "📊 발송내역"}</button>
              {canEdit && <button className="btn btn-sm" onClick={() => setEditId(editId === c.id ? null : c.id)}>{editId === c.id ? "접기" : "✏️ 내용"}</button>}
              {canEdit && <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { if (confirm(`'${c.name}' 채널 삭제?`)) { await deleteChannelAction(c.id); router.refresh(); } })}>삭제</button>}
            </div>

            {/* 실시간 토글 */}
            <div style={{ display: "flex", gap: 16, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span className={`tgl ${c.enabled ? "on" : ""}`} onClick={() => canEdit && toggle(c, "enabled")} /> <b>자동발송 허용</b> {c.enabled ? "✓" : "(유입만·발송 안 함)"}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, opacity: c.enabled ? 1 : 0.45 }}>
                <span className={`tgl ${c.send_sms ? "on" : ""}`} onClick={() => canEdit && c.enabled && toggle(c, "send_sms")} /> 문자
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, opacity: c.enabled ? 1 : 0.45 }}>
                <span className={`tgl ${c.send_email ? "on" : ""}`} onClick={() => canEdit && c.enabled && toggle(c, "send_email")} /> 메일
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginLeft: "auto" }}
                title="테스트 모드 — 실제 발송 없이 '발송될 내용'만 히스토리에 기록(오발송 사전검증)">
                <span className={`tgl ${c.test_mode ? "on" : ""}`} onClick={() => canEdit && toggle(c, "test_mode")} />
                <b style={{ color: c.test_mode ? "#b45309" : undefined }}>🧪 테스트 모드{c.test_mode ? "(실발송 안 함)" : ""}</b>
              </label>
            </div>

            {histId === c.id && (
              <div style={{ marginTop: 10, padding: 10, background: "var(--bg)", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 6 }}>자동발송 내역 (최근 {(sends[c.id] ?? []).length}건)</div>
                {(sends[c.id] ?? []).length === 0
                  ? <div style={{ fontSize: 12, color: "var(--ink3)" }}>아직 발송 내역이 없습니다.</div>
                  : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {(sends[c.id] ?? []).map((s) => (
                        <div key={s.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6, fontSize: 12 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <b>{s.brand_name || "—"}</b>
                            <span style={{ color: "var(--ink3)" }}>{s.to_masked}</span>
                            {s.sms_sent && <span className="pill grn" style={{ fontSize: 10 }}>문자 ✓</span>}
                            {s.email_sent && <span className="pill grn" style={{ fontSize: 10 }}>메일 ✓</span>}
                            {s.dry_run && <span className="pill" style={{ fontSize: 10, background: "#fef3c7", color: "#b45309" }}>🧪 테스트(미발송)</span>}
                            {!s.sms_sent && !s.email_sent && !s.dry_run && <span className="pill" style={{ fontSize: 10, background: "#fee2e2", color: "#b91c1c" }}>발송 실패</span>}
                            <span style={{ marginLeft: "auto", color: "var(--ink3)" }}>{new Date(s.sent_at).toLocaleString("ko-KR")}</span>
                          </div>
                          {s.error && <div style={{ marginTop: 3, color: "#b91c1c", fontSize: 11 }}>⚠ {s.error}</div>}
                          {s.sms_body && <div style={{ marginTop: 3, color: "var(--ink2)" }}>📱 {s.sms_body}</div>}
                          {(s.email_subject || s.email_body) && (
                            <div style={{ marginTop: 3, color: "var(--ink2)" }}>
                              ✉️ <b>{s.email_subject}</b>{s.email_body ? <span style={{ color: "var(--ink3)" }}> — {s.email_body.slice(0, 120)}{s.email_body.length > 120 ? "…" : ""}</span> : null}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {editId === c.id && canEdit && <ChannelEditor channel={c} onSaved={() => { setEditId(null); router.refresh(); }} />}
          </div>
        ))}
      </div>

      <div className="note" style={{ margin: "8px 16px 14px" }}>
        <b>2-키 인증</b>: POST URL 은 <code>?key=&lt;VERCEL_KEY&gt;&source=&lt;소스id&gt;</code> 형태입니다.
        <b>key</b> = Vercel 환경변수 <code>LEADHOOK_SECRET</code>(마스터 게이트, 직접 채워넣기) · <b>source</b> = 이 소스의 id(어느 유입 루트인지).
        복사한 URL의 <code>&lt;VERCEL_KEY&gt;</code>를 실제 값으로 바꿔 Zapier·외부 DB 에 넣으세요.
        <b> 자동발송 허용</b> 체크된 소스만 자동 문자·메일 발송(해제 시 유입만). 문구는 <b>비우면 전역 「신규 리드 자동 안내」</b>, 개별 지정은 「내용」. <code>{"{브랜드명}"}</code> <code>{"{담당자명}"}</code> 치환.
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
