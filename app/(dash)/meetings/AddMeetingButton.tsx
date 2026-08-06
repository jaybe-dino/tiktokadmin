"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMeetingAction } from "./actions";

// 미팅 일정 수동 추가 — 캘린더 상단 버튼 → 폼(일시·브랜드·제목·호스트·줌링크).
export default function AddMeetingButton({ brands }: { brands: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [when, setWhen] = useState("");
  const [brandId, setBrandId] = useState("");
  const [host, setHost] = useState("");
  const [dur, setDur] = useState("30");
  const [join, setJoin] = useState("");
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  function submit() {
    if (!topic.trim()) { flash("제목을 입력하세요."); return; }
    if (!when) { flash("일시를 선택하세요."); return; }
    start(async () => {
      const r = await createMeetingAction({
        brand_id: brandId || undefined, topic, scheduled_at: when,
        host_email: host || undefined, duration_min: Number(dur) || undefined, zoom_join_url: join || undefined,
      });
      if (r.ok) { setOpen(false); setTopic(""); setWhen(""); setBrandId(""); setHost(""); setJoin(""); flash("미팅 일정이 추가되었습니다."); router.refresh(); }
      else flash(r.error ?? "추가 실패");
    });
  }

  return (
    <>
      <button className="btn sm pri" onClick={() => setOpen((o) => !o)}>{open ? "닫기" : "+ 일정 추가"}</button>
      {open && (
        <div className="card" style={{ padding: 14, margin: "12px 0" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="f">제목 *</label>
              <input className="f" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 무신사 1:1 온보딩 미팅" />
            </div>
            <div>
              <label className="f">일시 * (KST)</label>
              <input className="f" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div>
              <label className="f">소요(분)</label>
              <input className="f" type="number" value={dur} onChange={(e) => setDur(e.target.value)} style={{ width: 80 }} />
            </div>
            <div>
              <label className="f">브랜드(선택)</label>
              <select className="f" value={brandId} onChange={(e) => setBrandId(e.target.value)} style={{ minWidth: 150 }}>
                <option value="">— 미연결 —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 160 }}>
              <label className="f">호스트 이메일(선택)</label>
              <input className="f" value={host} onChange={(e) => setHost(e.target.value)} placeholder="host@dinostudio.kr" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="f">줌/미팅 링크(선택)</label>
              <input className="f" value={join} onChange={(e) => setJoin(e.target.value)} placeholder="https://zoom.us/j/..." />
            </div>
            <button className="btn pri" disabled={pending} onClick={submit}>{pending ? "추가 중…" : "추가"}</button>
          </div>
          {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
        </div>
      )}
    </>
  );
}
