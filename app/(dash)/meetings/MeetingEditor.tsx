"use client";

// 미팅캘린더 블록 + 클릭 시 참석자·일시 수정 레이어 (PLAN §8 미팅).
//   수정 액션은 brand360/meeting-actions(updateMeetingAction) — 저장 시 재초대 메일 발송 옵션.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMeetingAction } from "@/app/(dash)/brand360/meeting-actions";

export interface CalendarMeeting {
  id: string;
  topic: string;
  status: string;
  brand_id: string | null;
  brand_name: string | null;
  scheduled_at: string | null;
  host_email: string | null;
  host_name: string | null;
  zoom_join_url: string | null;
  attendees: { name?: string; email: string }[] | null;
}

/** pg timestamptz 문자열 → KST datetime-local("YYYY-MM-DDTHH:MM") */
function toKstLocalInput(s: string | null): string {
  if (!s) return "";
  let iso = s.replace(" ", "T");
  if (/[+-]\d\d$/.test(iso)) iso += ":00"; // pg 의 "+00" 오프셋 보정
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function MeetingEditor({ meeting, cls }: { meeting: CalendarMeeting; cls: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [schedAt, setSchedAt] = useState(() => toKstLocalInput(meeting.scheduled_at));
  const [attendees, setAttendees] = useState<{ name: string; email: string }[]>(
    () => (meeting.attendees ?? []).filter((a) => a?.email).map((a) => ({ name: a.name ?? "", email: a.email })),
  );
  const [zoomUrl, setZoomUrl] = useState(meeting.zoom_join_url ?? "");
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [resend, setResend] = useState(true);
  const [msg, setMsg] = useState("");

  const label = `${meeting.host_name || meeting.host_email || "호스트 미지정"} · ${meeting.brand_name || "미매칭"} · ${meeting.topic || "미팅"}`;

  function addAttendee() {
    const email = addEmail.trim();
    if (!EMAIL_RE.test(email)) { setMsg("참석자 이메일 형식을 확인하세요."); return; }
    if (attendees.some((a) => a.email.toLowerCase() === email.toLowerCase())) { setMsg("이미 추가된 이메일입니다."); return; }
    setAttendees([...attendees, { name: addName.trim(), email }]);
    setAddName(""); setAddEmail(""); setMsg("");
  }

  function save() {
    start(async () => {
      const r = await updateMeetingAction(meeting.id, {
        scheduledAt: schedAt, attendees, zoomJoinUrl: zoomUrl, resendInvites: resend,
      });
      if (!r.ok) { setMsg(r.error ?? "저장 실패"); return; }
      const inv = r.invite;
      setMsg(
        !resend
          ? "저장됨 (재초대 미발송)"
          : inv?.skipped
            ? "저장됨 · RESEND 미설정 — 재초대 스킵"
            : `저장됨 · 재초대 ${inv?.sent ?? 0}건 발송${inv && inv.failed > 0 ? ` (실패 ${inv.failed})` : ""}${inv?.errors?.length ? ` — ${inv.errors[0]}` : ""}`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <button
        className={cls}
        title={label}
        style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", border: "none", fontFamily: "inherit" }}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", cursor: "default" }}>
            <div className="hd" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 13 }}>{meeting.brand_name || "미매칭"} · {meeting.topic || "미팅"}</b>
              <button className="btn sm" onClick={() => setOpen(false)}>닫기</button>
            </div>
            <div className="bd" style={{ display: "grid", gap: 10, fontSize: 12.5 }}>
              <div style={{ color: "var(--ink3)", fontSize: 12 }}>
                지정인(호스트): <b>{meeting.host_name || meeting.host_email || "미지정"}</b>
                {meeting.brand_id && (
                  <> · <Link href={`/brand/${meeting.brand_id}`} style={{ color: "var(--acc)", fontWeight: 700 }}>브랜드360 →</Link></>
                )}
              </div>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontWeight: 700 }}>일시 (KST)</span>
                <input className="f" type="datetime-local" value={schedAt} onChange={(e) => setSchedAt(e.target.value)} />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontWeight: 700 }}>줌 링크</span>
                <input className="f" value={zoomUrl} onChange={(e) => setZoomUrl(e.target.value)} placeholder="https://zoom.us/j/…" />
              </label>

              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 700 }}>참석자 {attendees.length}명</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {attendees.length === 0 && <span className="note">참석자 없음 — 아래에서 추가하세요.</span>}
                  {attendees.map((a) => (
                    <span key={a.email} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {a.name ? `${a.name} <${a.email}>` : a.email}
                      <button
                        style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "var(--ink3)" }}
                        title="제외"
                        onClick={() => setAttendees(attendees.filter((x) => x.email !== a.email))}
                      >✕</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input className="f" style={{ width: 100 }} value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="이름(선택)" />
                  <input className="f" style={{ flex: 1, minWidth: 140 }} value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="이메일 추가" />
                  <button className="btn sm" onClick={addAttendee}>+ 추가</button>
                </div>
              </div>

              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} />
                저장 시 참석자에게 재초대 메일 발송 (ICS 일정 갱신)
              </label>

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button className="btn pri" disabled={pending || !schedAt} onClick={save}>
                  {pending ? "저장 중…" : "저장"}
                </button>
                {msg && <span className="note">{msg}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
