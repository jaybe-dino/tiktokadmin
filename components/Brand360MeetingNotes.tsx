"use client";
// 회의록 탭 — 자동 회의록(미팅 요약·전사)을 날짜별로 + 직접 회의록(텍스트·파일) 추가/삭제.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMeetingNoteAction, deleteMeetingNoteAction } from "@/app/(dash)/brand360/actions";
import type { MeetingNote } from "@/lib/meeting-notes";

export interface AutoMeeting {
  id: string; topic: string | null; status: string;
  started_at: string | null; scheduled_at: string | null;
  summary_md: string | null; transcript: string | null;
  // Zoom 자동 수집(0097) — 미적용 DB 에서는 undefined.
  transcript_status?: string | null;
  transcript_source?: string | null;
  transcript_error?: string | null;
  recording_share_url?: string | null;
  host_email?: string | null;
  attendees?: { name?: string; email?: string }[] | null;
  duration_min?: number | null;
}

// 전사 수집 상태 표시.
const COLLECT: Record<string, { label: string; color: string }> = {
  ready: { label: "전사 수집됨", color: "#0b7a52" },
  pending: { label: "전사 대기 중", color: "#c25400" },
  recording_only: { label: "녹음만 있음 · 전사 없음", color: "#c25400" },
  failed: { label: "전사 수집 실패", color: "#c92a2a" },
};

const ymd = (s: string | null): string => (s ? s.slice(0, 10) : "");

export default function Brand360MeetingNotes({ brandId, meetings, notes }: {
  brandId: string; meetings: AutoMeeting[]; notes: MeetingNote[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // 자동 회의록(요약·전사 있는 미팅만) + 수기 회의록을 날짜 기준 통합 정렬.
  type Row =
    | { t: "auto"; date: string; m: AutoMeeting }
    | { t: "note"; date: string; n: MeetingNote };
  const rows: Row[] = [
    ...meetings
      // 요약·전사가 있거나, Zoom 녹화가 잡혀 수집 상태가 있는 회의(대기·녹음만 포함)를 보여준다.
      .filter((m) => (m.summary_md && m.summary_md.trim()) || (m.transcript && m.transcript.trim())
        || (m.transcript_status && m.transcript_status !== "none"))
      .map((m) => ({ t: "auto" as const, date: ymd(m.started_at || m.scheduled_at), m })),
    ...notes.map((n) => ({ t: "note" as const, date: n.note_date, n })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  function submit() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("brand_id", brandId);
    setMsg("");
    start(async () => {
      try {
        const r = await addMeetingNoteAction(fd);
        if (r.ok) { formRef.current?.reset(); setOpen(false); router.refresh(); }
        else setMsg(r.error ?? "실패");
      } catch {
        // 업로드 실패(파일 과대·네트워크) — 미처리 예외 대신 안내.
        setMsg("저장 중 오류가 발생했습니다. 파일 용량(녹음 25MB·첨부 15MB↓)과 네트워크를 확인해 주세요.");
      }
    });
  }
  function del(id: string) {
    if (!confirm("이 회의록을 삭제할까요?")) return;
    start(async () => { await deleteMeetingNoteAction(id); router.refresh(); });
  }

  return (
    <div className="card">
      <div className="hd">
        <b>회의록</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>자동(미팅 요약·전사) + 직접 입력 · 날짜별</span>
        <button className="btn sm pri" style={{ marginLeft: "auto" }} onClick={() => setOpen((o) => !o)}>{open ? "닫기" : "+ 회의록 추가"}</button>
      </div>

      {open && (
        <form ref={formRef} className="bd" style={{ display: "grid", gap: 8, borderBottom: "1px solid var(--line)" }}
          onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div><label className="label">회의 날짜</label><input name="note_date" type="date" className="input" /></div>
            <div style={{ flex: 1, minWidth: 180 }}><label className="label">제목</label><input name="title" className="input" style={{ width: "100%" }} placeholder="예: 킥오프 미팅 회의록" /></div>
          </div>
          <div><label className="label">회의록 내용(텍스트)</label>
            <textarea name="body" className="input" rows={5} style={{ width: "100%" }} placeholder="논의 내용·결정사항·다음 액션 등" /></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 200 }}><label className="label">파일 업로드 · 녹음(25MB↓) / 첨부(15MB↓)</label><input name="file" type="file" className="input" style={{ width: "100%" }} accept="audio/*,video/*,.pdf,.doc,.docx,.txt,.png,.jpg" /></div>
            <div style={{ flex: 1, minWidth: 200 }}><label className="label">또는 파일 링크(구글드라이브 등)</label><input name="file_url" type="url" className="input" style={{ width: "100%" }} placeholder="https://drive.google.com/…" /></div>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input name="transcribe" type="checkbox" defaultChecked /> 🎙️ 녹음 파일이면 자동 전사(한국어)·AI 회의록 작성 <span style={{ color: "var(--ink3)", fontSize: 11 }}>(전사에 30초~1분 소요될 수 있어요)</span>
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>{pending ? "저장·전사 중…" : "저장"}</button>
            {msg && <span className="note" style={{ color: "var(--bad)" }}>{msg}</span>}
          </div>
        </form>
      )}

      <div className="bd" style={{ display: "grid", gap: 10 }}>
        {rows.length === 0 && <div className="note">회의록이 없습니다. 미팅 요약이 처리되거나, 위에서 직접 회의록을 추가하면 날짜별로 표시됩니다.</div>}
        {rows.map((r) => r.t === "auto" ? (
          <div key={`a-${r.m.id}`} style={{ borderLeft: "3px solid var(--acc)", paddingLeft: 10 }}>
            <div style={{ fontSize: 12, color: "var(--ink3)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span className="pill" style={{ fontSize: 10 }}>{r.date || "날짜 미상"}</span>
              <span>자동 · {r.m.topic || "미팅"}</span>
              {r.m.duration_min ? <span>· {r.m.duration_min}분</span> : null}
              {(() => {
                const c = r.m.transcript_status ? COLLECT[r.m.transcript_status] : null;
                return c ? <span style={{ color: c.color, fontWeight: 600 }}>· {c.label}</span> : null;
              })()}
              {r.m.transcript_source === "zoom" && <span>· 출처 Zoom 전사</span>}
            </div>
            {/* 참석자 — 확인 가능한 범위만(초대·참가자 기록에 남은 사람). */}
            {(r.m.attendees?.length || r.m.host_email) && (
              <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                참석: {[r.m.host_email, ...(r.m.attendees ?? []).map((a) => a.name || a.email)].filter(Boolean).join(", ")}
              </div>
            )}
            {r.m.transcript_status === "recording_only" && (
              <div style={{ fontSize: 11.5, color: "#c25400", marginTop: 3 }}>
                {r.m.transcript_error || "Zoom 전사 파일이 없습니다 — 계정의 오디오 자동 전사 설정·지원 언어를 확인해 주세요."}
              </div>
            )}
            {r.m.summary_md && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 10.5, color: "var(--ink3)" }}>AI 정리 — 원문은 아래 「전사 전문」에서 확인하세요.</div>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.6, fontFamily: "inherit", marginTop: 2 }}>{r.m.summary_md}</pre>
              </div>
            )}
            {r.m.transcript && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--ink3)" }}>전사 전문 보기 (원문)</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, lineHeight: 1.5, fontFamily: "inherit", color: "var(--ink2)" }}>{r.m.transcript}</pre>
              </details>
            )}
            {r.m.recording_share_url && (
              <a className="btn btn-sm" style={{ marginTop: 4 }} href={r.m.recording_share_url} target="_blank" rel="noreferrer">
                🎥 Zoom 녹화 열기
              </a>
            )}
          </div>
        ) : (
          <div key={`n-${r.n.id}`} style={{ borderLeft: "3px solid #16a34a", paddingLeft: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="pill" style={{ fontSize: 10 }}>{r.date}</span>
              <b style={{ fontSize: 13 }}>{r.n.title || "회의록"}</b>
              <span style={{ fontSize: 10.5, color: "var(--ink3)" }}>직접 입력{r.n.created_by ? ` · ${r.n.created_by}` : ""}</span>
              <button className="btn btn-sm" style={{ marginLeft: "auto", color: "var(--bad)" }} disabled={pending} onClick={() => del(r.n.id)}>삭제</button>
            </div>
            {r.n.body && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.6, fontFamily: "inherit", marginTop: 4 }}>{r.n.body}</pre>}
            {(r.n.has_file || r.n.file_url) && (
              <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                {r.n.has_file && <a className="btn btn-sm" href={`/api/brand/meeting-note/${r.n.id}/file`} target="_blank" rel="noreferrer">📎 {r.n.file_name || "첨부파일"}</a>}
                {r.n.file_url && <a className="btn btn-sm" href={r.n.file_url} target="_blank" rel="noreferrer">🔗 파일 링크</a>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
