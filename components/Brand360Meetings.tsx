"use client";

// v3.1 미팅·메일 탭 — 미팅 카드(회의록 요약·전사·녹화·다음 액션 반영) + 팔로업 메일 초안 카드.
// meetings·email_drafts 실데이터. 승인·발송은 approveDraftAction(canSend 게이트 경유).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDraftAction, discardDraftAction, editDraftAction, setNextActionAction } from "@/app/actions";

export interface MeetingRow {
  id: string; topic: string; status: string; started_at: string | null; scheduled_at: string | null;
  duration_min: number | null; recording_url: string | null; transcript: string | null; summary_md: string | null;
}
export interface DraftRow {
  id: string; kind: string; to_email: string; subject: string; body_md: string; created_at: string;
}

const MEETING_STATUS: Record<string, { label: string; cls: string }> = {
  ready: { label: "회의록 완료", cls: "grn" },
  summarizing: { label: "요약 중", cls: "amb" },
  transcribing: { label: "전사 중", cls: "amb" },
  received: { label: "수신됨", cls: "" },
  scheduled: { label: "예정", cls: "" },
  no_show: { label: "노쇼", cls: "red" },
  canceled: { label: "취소", cls: "red" },
  unmatched: { label: "매칭 필요", cls: "red" },
  error: { label: "오류", cls: "red" },
};

export default function Brand360Meetings({ brandId, meetings, drafts }: {
  brandId: string; meetings: MeetingRow[]; drafts: DraftRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showTranscript, setShowTranscript] = useState<string | null>(null);
  const [naFor, setNaFor] = useState<string | null>(null);
  const [naText, setNaText] = useState("");
  const [naDue, setNaDue] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [subj, setSubj] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState("");

  return (
    <div className="grid g2" style={{ gap: 14 }}>
      {/* ── 미팅 ── */}
      <div className="card">
        <div className="hd"><b>미팅 {meetings.length}건</b></div>
        <div className="bd" style={{ display: "grid", gap: 10 }}>
          {meetings.length === 0 && (
            <p className="note">기록된 미팅이 없습니다 — 줌 예약이 잡히면 자동 등록·회의록 등재됩니다.</p>
          )}
          {meetings.map((m) => {
            const st = MEETING_STATUS[m.status] ?? { label: m.status, cls: "" };
            const when = (m.started_at ?? m.scheduled_at)?.slice(0, 16).replace("T", " ") ?? "일시 미상";
            return (
              <div key={m.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 12.5 }}>
                    {when} · {m.topic || "1:1 상담"}{m.duration_min ? ` (${m.duration_min}분)` : ""}
                  </b>
                  <span className={`chip ${st.cls}`}>{st.label}</span>
                </div>
                {m.summary_md ? (
                  <div className="aiw" style={{ marginTop: 10 }}>
                    <h5>🤖 회의록 요약</h5>
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.7, fontFamily: "inherit" }}>{m.summary_md}</pre>
                  </div>
                ) : (
                  <p className="note" style={{ marginTop: 8 }}>요약 미생성</p>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn sm"
                    disabled={!m.transcript}
                    title={m.transcript ? "" : "전사 없음"}
                    onClick={() => setShowTranscript(showTranscript === m.id ? null : m.id)}
                  >
                    전사 전문
                  </button>
                  {m.recording_url ? (
                    <a className="btn sm" href={m.recording_url} target="_blank">녹화 링크</a>
                  ) : (
                    <button className="btn sm" disabled title="녹화 없음">녹화 링크</button>
                  )}
                  <button
                    className="btn sm pri"
                    onClick={() => {
                      setNaFor(naFor === m.id ? null : m.id);
                      // 요약의 "다음 액션" 줄을 초기값으로.
                      const line = m.summary_md?.split("\n").find((l) => l.includes("다음 액션"));
                      setNaText(line ? line.replace(/^[^:：]*[:：]\s*/, "").replace(/^\*+|\[.\]|☐/g, "").trim() : "");
                    }}
                  >
                    다음 액션 반영
                  </button>
                </div>
                {showTranscript === m.id && m.transcript && (
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, lineHeight: 1.6, marginTop: 8, maxHeight: 240, overflowY: "auto", background: "#f8fafc", borderRadius: 8, padding: 10 }}>
                    {m.transcript}
                  </pre>
                )}
                {naFor === m.id && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <input className="f" style={{ flex: 1, minWidth: 160 }} value={naText} onChange={(e) => setNaText(e.target.value)} placeholder="다음 액션" />
                    <input className="f" style={{ width: 130 }} type="date" value={naDue} onChange={(e) => setNaDue(e.target.value)} />
                    <button
                      className="btn sm pri"
                      disabled={pending || !naText.trim()}
                      onClick={() =>
                        start(async () => {
                          const r = await setNextActionAction(brandId, naText.trim(), naDue || undefined);
                          setMsg(r.ok ? "다음 액션 반영됨" : r.error ?? "실패");
                          if (r.ok) setNaFor(null);
                          router.refresh();
                        })
                      }
                    >
                      저장
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 팔로업 메일 초안 ── */}
      <div className="card">
        <div className="hd">
          <b>팔로업 메일 초안</b>
          {drafts.length > 0 && <span className="chip amb">승인 대기 {drafts.length}</span>}
        </div>
        <div className="bd" style={{ display: "grid", gap: 12 }}>
          {drafts.length === 0 && (
            <p className="note">승인 대기 초안이 없습니다 — 미팅 회의록 등재·수신 메일에서 자동 생성되거나, 헤더 [✉️ 메일 → AI 초안]으로 만들 수 있습니다.</p>
          )}
          {drafts.map((d) => (
            <div key={d.id}>
              <div className="kv" style={{ marginBottom: 8 }}>
                <dt>받는이</dt><dd>{d.to_email || "이메일 없음"}</dd>
                <dt>제목</dt><dd>{editId === d.id ? <input className="f" value={subj} onChange={(e) => setSubj(e.target.value)} /> : d.subject}</dd>
              </div>
              {editId === d.id ? (
                <textarea className="f" style={{ minHeight: 160, fontSize: 12.5, lineHeight: 1.7 }} value={body} onChange={(e) => setBody(e.target.value)} />
              ) : (
                <pre style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, fontSize: 12.5, lineHeight: 1.8, background: "#fafbfd", whiteSpace: "pre-wrap", fontFamily: "inherit", maxHeight: 260, overflowY: "auto" }}>
                  {d.body_md}
                </pre>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {editId === d.id ? (
                  <button
                    className="btn"
                    style={{ flex: 1 }}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await editDraftAction(d.id, subj, body);
                        setMsg(r.ok ? "초안 수정됨" : r.error ?? "실패");
                        setEditId(null);
                        router.refresh();
                      })
                    }
                  >
                    저장
                  </button>
                ) : (
                  <button className="btn" style={{ flex: 1 }} onClick={() => { setEditId(d.id); setSubj(d.subject); setBody(d.body_md); }}>
                    ✏️ 수정
                  </button>
                )}
                <button
                  className="btn grn"
                  style={{ flex: 1 }}
                  disabled={pending || !d.to_email}
                  onClick={() =>
                    start(async () => {
                      const edits = editId === d.id ? { subject: subj, body } : undefined;
                      const r = await approveDraftAction(d.id, edits);
                      setMsg(r.ok ? (r.sent ? "승인·발송됨" : "승인됨 (RESEND 미설정 — 미발송)") : r.error ?? "발송 게이트 차단");
                      router.refresh();
                    })
                  }
                >
                  승인·발송
                </button>
                <button
                  className="btn dgr"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await discardDraftAction(d.id);
                      setMsg(r.ok ? "발송 안 함 처리" : r.error ?? "실패");
                      router.refresh();
                    })
                  }
                >
                  발송 안 함
                </button>
              </div>
            </div>
          ))}
          {msg && <div className="note">{msg}</div>}
        </div>
      </div>
    </div>
  );
}
