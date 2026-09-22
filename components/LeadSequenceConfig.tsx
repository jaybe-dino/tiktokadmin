"use client";
// 신규 리드 연속 안내(드립) 설정 — 며칠간 · 몇 시에 · 일차마다 어떤 문구로 보낼지.
import { useState, useTransition } from "react";
import type { SeqSchedule, SeqStep, SeqQueueRow } from "@/lib/lead-sequence";
import {
  saveSeqScheduleAction, saveSeqStepAction, listSeqStepsAction, listSeqQueueAction,
  previewSeqScheduleAction, runSeqNowAction, cancelSeqAction,
} from "@/app/(dash)/settings/sequence-actions";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_OPTS = [3, 5, 7, 10, 14, 21, 30];
// 한국시간으로 보여준다 — 서버·브라우저 표준시와 무관하게 실제 발송 시각이 헷갈리지 않게.
const kst = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL: Record<string, string> = { queued: "예정", sent: "발송됨", failed: "실패", skipped: "건너뜀", canceled: "중단" };

export default function LeadSequenceConfig({ schedule, steps, queue, canEdit }: {
  schedule: SeqSchedule; steps: SeqStep[]; queue: SeqQueueRow[]; canEdit: boolean;
}) {
  const [s, setS] = useState(schedule);
  const [list, setList] = useState(steps);
  const [rows, setRows] = useState(queue);
  const [open, setOpen] = useState<number | null>(null);
  const [slots, setSlots] = useState<{ day_no: number; due_at: string }[] | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };
  const setSched = <K extends keyof SeqSchedule>(k: K, v: SeqSchedule[K]) => setS((p) => ({ ...p, [k]: v }));
  const setStep = (day: number, patch: Partial<SeqStep>) =>
    setList((p) => p.map((x) => (x.day_no === day ? { ...x, ...patch } : x)));

  const saveSched = () => start(async () => {
    const r = await saveSeqScheduleAction(s);
    if (!r.ok) { flash(r.error ?? "저장 실패"); return; }
    // 일수가 바뀌면 일차 목록도 다시 받는다.
    const l = await listSeqStepsAction(s.days);
    if (l.ok && l.steps) setList(l.steps);
    flash("일정 저장됨 ✓");
  });
  const saveStep = (day: number) => start(async () => {
    const step = list.find((x) => x.day_no === day);
    if (!step) return;
    const r = await saveSeqStepAction(step);
    flash(r.ok ? `${day}일차 저장됨 ✓` : r.error ?? "저장 실패");
  });
  const preview = () => start(async () => {
    const r = await previewSeqScheduleAction(s);
    if (r.ok && r.slots) { setSlots(r.slots); flash("지금 리드가 들어왔다고 가정한 예정표입니다(발송 아님)"); }
  });
  const runNow = () => start(async () => {
    if (!confirm("예정 시각이 지난 안내를 지금 발송합니다. 진행할까요?")) return;
    const r = await runSeqNowAction();
    if (!r.ok) { flash(r.error ?? "실행 실패"); return; }
    const q = await listSeqQueueAction();
    if (q.ok && q.rows) setRows(q.rows);
    flash(r.summary ?? "완료");
  });
  const cancelOne = (brandId: string, name: string) => start(async () => {
    if (!confirm(`${name} 의 남은 안내를 중단할까요?`)) return;
    const r = await cancelSeqAction(brandId, "설정 화면에서 중단");
    if (!r.ok) { flash(r.error ?? "실패"); return; }
    const q = await listSeqQueueAction();
    if (q.ok && q.rows) setRows(q.rows);
    flash(`${r.canceled ?? 0}건 중단됨`);
  });

  const onCount = list.filter((x) => x.enabled).length;

  return (
    <div className="card">
      <div className="card-hd">
        <b>신규 리드 연속 안내 — 일차별 문자·메일</b>
        <span className={`chip ${s.enabled ? "chip-grn" : "chip-amb"}`} style={{ marginLeft: "auto" }}>
          {s.enabled ? `ON · ${s.days}일 · ${s.hour}시` : "OFF"}
        </span>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 14 }}>
        <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.6 }}>
          위 「신규 리드 자동 안내」의 <b>대상 소스</b>로 들어온 리드에게, 유입 다음부터 매일 지정 시각에 일차별 문구를 보냅니다.
          문구가 비어 있거나 꺼진 일차는 건너뜁니다. <b>상담·미팅 등 단계가 진전되면 남은 안내는 자동 중단</b>됩니다.
        </div>

        {/* 일정 */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${s.enabled ? "on" : ""}`} onClick={() => canEdit && setSched("enabled", !s.enabled)} /> 연속 안내 사용
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            기간
            <select className="f" value={s.days} disabled={!canEdit} onChange={(e) => setSched("days", Number(e.target.value))} style={{ width: 90 }}>
              {DAY_OPTS.map((d) => <option key={d} value={d}>{d}일</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            발송 시각
            <select className="f" value={s.hour} disabled={!canEdit} onChange={(e) => setSched("hour", Number(e.target.value))} style={{ width: 110 }}>
              {HOURS.map((h) => <option key={h} value={h}>{h}시 (KST)</option>)}
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${s.day1Immediate ? "on" : ""}`} onClick={() => canEdit && setSched("day1Immediate", !s.day1Immediate)} />
            1일차는 유입 즉시
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${s.skipWeekend ? "on" : ""}`} onClick={() => canEdit && setSched("skipWeekend", !s.skipWeekend)} /> 주말 건너뛰기
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className={`tgl ${s.stopOnProgress ? "on" : ""}`} onClick={() => canEdit && setSched("stopOnProgress", !s.stopOnProgress)} /> 단계 진전 시 중단
          </label>
          {canEdit && <button className="btn btn-sm btn-primary" disabled={pending} onClick={saveSched}>일정 저장</button>}
          <button className="btn btn-sm" disabled={pending} onClick={preview}>예정표 미리보기</button>
        </div>

        {slots && (
          <div className="note" style={{ fontSize: 12 }}>
            <b>지금 리드가 들어온다면</b> — {slots.map((x) => `${x.day_no}일차 ${kst(x.due_at)}`).join(" / ")}
          </div>
        )}

        {/* 일차별 문구 */}
        <div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 6 }}>
            일차별 문구 · 켜진 일차 {onCount}/{list.length} — 일차를 눌러 펼친 뒤 저장하세요.
            치환변수: <code>{"{브랜드명}"}</code> <code>{"{담당자명}"}</code> <code>{"{일차}"}</code>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {list.map((st) => {
              const ready = (st.send_sms && st.sms_body.trim()) || (st.send_email && st.email_body.trim());
              return (
                <div key={st.day_no} style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", flexWrap: "wrap" }}>
                    <span className={`tgl ${st.enabled ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { enabled: !st.enabled })} />
                    <b style={{ fontSize: 13, minWidth: 54 }}>{st.day_no}일차</b>
                    <span style={{ fontSize: 11, color: st.enabled && !ready ? "#c92a2a" : "var(--ink3)" }}>
                      {!st.enabled ? "꺼짐 — 이 날은 건너뜁니다"
                        : ready ? `${st.send_sms && st.sms_body.trim() ? "문자" : ""}${st.send_sms && st.sms_body.trim() && st.send_email && st.email_body.trim() ? "·" : ""}${st.send_email && st.email_body.trim() ? "메일" : ""} 발송`
                        : "문구가 비어 있어 발송되지 않습니다"}
                    </span>
                    <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpen(open === st.day_no ? null : st.day_no)}>
                      {open === st.day_no ? "접기" : "문구 편집"}
                    </button>
                  </div>
                  {open === st.day_no && (
                    <div style={{ padding: "0 10px 10px", display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                          <span className={`tgl ${st.send_sms ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { send_sms: !st.send_sms })} /> 문자
                        </label>
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                          <span className={`tgl ${st.send_email ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { send_email: !st.send_email })} /> 이메일
                        </label>
                      </div>
                      {st.send_sms && (
                        <label className="label" style={{ display: "block" }}>
                          문자 내용 <span style={{ color: "var(--ink3)", fontWeight: 400 }}>{st.sms_body.length}자 · 90바이트 넘으면 LMS</span>
                          <textarea className="f" rows={2} disabled={!canEdit} value={st.sms_body}
                            onChange={(e) => setStep(st.day_no, { sms_body: e.target.value })}
                            placeholder="예: {담당자명}님, 어제 보내드린 자료 확인해보셨을까요?" style={{ width: "100%", boxSizing: "border-box" }} />
                        </label>
                      )}
                      {st.send_email && (
                        <>
                          <label className="label" style={{ display: "block" }}>
                            메일 제목
                            <input className="f" disabled={!canEdit} value={st.email_subject}
                              onChange={(e) => setStep(st.day_no, { email_subject: e.target.value })}
                              placeholder="예: [GloveK] {브랜드명} 틱톡샵 진출 안내" style={{ width: "100%", boxSizing: "border-box" }} />
                          </label>
                          <label className="label" style={{ display: "block" }}>
                            메일 본문
                            <textarea className="f" rows={5} disabled={!canEdit} value={st.email_body}
                              onChange={(e) => setStep(st.day_no, { email_body: e.target.value })}
                              style={{ width: "100%", boxSizing: "border-box" }} />
                          </label>
                        </>
                      )}
                      {canEdit && <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => saveStep(st.day_no)} style={{ justifySelf: "start" }}>{st.day_no}일차 저장</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 예정·이력 */}
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--ink3)" }}>예정 · 최근 발송</span>
            {canEdit && <button className="btn btn-sm" disabled={pending} onClick={runNow}>예정분 지금 발송</button>}
          </div>
          {rows.length === 0 ? (
            <div className="note" style={{ fontSize: 12 }}>예약된 안내가 없습니다 — 연속 안내를 켠 뒤 들어온 리드부터 예약됩니다.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="t" style={{ fontSize: 12, width: "100%" }}>
                <thead><tr><th>브랜드</th><th>일차</th><th>예정 시각</th><th>상태</th><th>메모</th><th /></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.brand_id}-${r.day_no}-${i}`}>
                      <td><a href={`/brand/${r.brand_id}`}>{r.brand_name}</a></td>
                      <td>{r.day_no}일차</td>
                      <td>{kst(r.due_at)}</td>
                      <td>{STATUS_LABEL[r.status] ?? r.status}{r.channels.length ? ` (${r.channels.map((c) => (c === "sms" ? "문자" : "메일")).join("·")})` : ""}</td>
                      <td style={{ color: "var(--ink3)" }}>{r.note}</td>
                      <td>{canEdit && r.status === "queued" && <button className="btn btn-sm" onClick={() => cancelOne(r.brand_id, r.brand_name)} style={{ color: "#e03131" }}>중단</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="note" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
          ⚠️ 연속 발송은 1회성 안내와 달리 <b>광고성 정보</b>로 볼 여지가 큽니다. 문자·메일 문구에
          <b> [광고] 표기와 무료 수신거부 방법</b>을 넣어 주세요(정보통신망법). 수신거부 요청이 오면 브랜드 원장에서
          수신거부로 표시하거나 위 표에서 「중단」을 눌러 주세요.
        </div>

        {msg && <div style={{ fontSize: 12, color: "var(--ink2)" }}>{msg}</div>}
      </div>
    </div>
  );
}
