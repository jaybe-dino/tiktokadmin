"use client";
// 유입 소스 키별 연속 안내(드립) — 그 키로 들어온 리드에게 N일간 매일 문자·메일.
//   키 한 줄 안에서 펼쳐 쓰도록 만든 편집기(채널 관리 화면에 붙는다).
//   회차: 「유입 1일차」 … 「유입 N일차」 — 유입 즉시 발송은 기존 「내용」(1회성 자동안내)이 담당한다.
//   설정: 몇 일차까지 · 기본 시각 · 단계 진전 시 중단
//         + 회차별 on/off · 문자/메일 각각 · 회차마다 다른 시각 · 문구
import { useEffect, useState, useTransition } from "react";
import type { SeqConfig, SeqStep, SeqQueueRow } from "@/lib/lead-sequence";
import { dayLabel } from "@/lib/lead-sequence-plan";
import {
  saveSeqConfigAction, saveSeqStepAction, listSeqStepsAction, listSeqQueueAction,
  previewSeqScheduleAction, copySeqStepsAction, cancelSeqAction,
} from "@/app/(dash)/channels/sequence-actions";
import { approvedCopy, APPROVED_COPY } from "@/lib/lead-sequence-copy";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_OPTS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30];   // 몇 일차까지
const kst = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
const STATUS_LABEL: Record<string, string> = { queued: "예정", sent: "발송됨", failed: "실패", skipped: "건너뜀", canceled: "중단" };

export default function ChannelSequenceEditor({ channelId, config, canEdit, others }: {
  channelId: string;
  config: SeqConfig;
  canEdit: boolean;
  others: { id: string; name: string }[];   // 문구 복사용 다른 키 목록
}) {
  const [c, setC] = useState<SeqConfig>(config);
  const [steps, setSteps] = useState<SeqStep[]>([]);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [rows, setRows] = useState<SeqQueueRow[]>([]);
  const [slots, setSlots] = useState<{ day_no: number; due_at: string }[] | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [msg, setMsg] = useState("");
  // 오류는 자동으로 사라지지 않게 따로 둔다(원인을 놓치지 않도록).
  const [err, setErr] = useState("");
  const [loadErr, setLoadErr] = useState("");
  // 저장 안 된 회차 — 입력이 날아가지 않게 다시 불러올 때 덮어쓰지 않는다.
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();

  const flash = (m: string) => { setMsg(m); setErr(""); setTimeout(() => setMsg(""), 4000); };
  const fail = (m: string) => { setErr(m); setMsg(""); };
  const set = <K extends keyof SeqConfig>(k: K, v: SeqConfig[K]) => setC((p) => ({ ...p, [k]: v }));
  const setStep = (day: number, patch: Partial<SeqStep>) => {
    setSteps((p) => p.map((x) => (x.day_no === day ? { ...x, ...patch } : x)));
    setDirty((p) => new Set(p).add(day));   // 저장 전까지 "저장 안 됨"으로 표시
  };
  const hourByDay = () => Object.fromEntries(steps.map((x) => [x.day_no, x.send_hour]));

  const load = () => start(async () => {
    const [s, q] = await Promise.all([listSeqStepsAction(channelId, c.days), listSeqQueueAction(channelId)]);
    if (s.ok && s.steps) {
      // 아직 저장하지 않은 회차의 입력은 그대로 둔다(새로 불러온 값으로 덮지 않는다).
      setSteps((prev) => s.steps!.map((n) => (dirty.has(n.day_no) ? prev.find((x) => x.day_no === n.day_no) ?? n : n)));
      setLoadErr("");
    } else {
      setLoadErr(s.error ?? "회차 문구를 불러오지 못했습니다.");
    }
    if (q.ok && q.rows) setRows(q.rows);
  });
  useEffect(load, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const saveCfg = () => start(async () => {
    const r = await saveSeqConfigAction(c);
    if (!r.ok) { fail(r.error ?? "일정 저장 실패"); return; }
    const s = await listSeqStepsAction(channelId, c.days);   // 회차 범위가 바뀌면 목록도 달라진다
    if (s.ok && s.steps) setSteps((prev) => s.steps!.map((n) => (dirty.has(n.day_no) ? prev.find((x) => x.day_no === n.day_no) ?? n : n)));
    else if (s.error) setLoadErr(s.error);
    flash("일정 저장됨 ✓ (저장 후 다시 읽어 확인)");
  });
  const saveStep = (day: number) => start(async () => {
    const step = steps.find((x) => x.day_no === day);
    if (!step) return;
    const r = await saveSeqStepAction(step);
    if (!r.ok) { fail(`${dayLabel(day)} 저장 실패 — ${r.error ?? "원인 미상"}`); return; }
    // 저장된 값(서버 재조회 결과)으로 화면을 맞추고 "저장 안 됨" 표시를 지운다.
    if (r.saved) setSteps((p) => p.map((x) => (x.day_no === day ? r.saved! : x)));
    setDirty((p) => { const n = new Set(p); n.delete(day); return n; });
    flash(`${dayLabel(day)} 저장됨 ✓ (저장 후 다시 읽어 확인)`);
  });
  const preview = () => start(async () => {
    const r = await previewSeqScheduleAction(c, hourByDay());
    if (r.ok && r.slots) { setSlots(r.slots); flash("지금 이 키로 리드가 들어왔다고 가정한 예정표입니다(발송 아님)"); }
    else fail("예정표를 계산하지 못했습니다.");
  });
  // 승인 문안(1~4일차)을 화면에 채운다 — 저장은 각 회차 「저장」을 눌러야 반영된다.
  const loadApproved = () => {
    setSteps((p) => p.map((x) => {
      const a = approvedCopy(x.day_no);
      return a ? { ...x, enabled: true, send_sms: true, send_email: true,
        email_subject: a.email_subject, email_body: a.email_body, sms_body: a.sms_body } : x;
    }));
    setDirty(new Set(APPROVED_COPY.map((a) => a.day_no)));
    flash("승인 문안을 채웠습니다 — 각 회차의 「저장」을 눌러야 DB 에 들어갑니다.");
  };
  const doCopy = () => start(async () => {
    const r = await copySeqStepsAction(copyFrom, channelId);
    if (!r.ok) { fail(r.error ?? "복사 실패"); return; }
    const s = await listSeqStepsAction(channelId, c.days);
    if (s.ok && s.steps) setSteps(s.steps);
    flash(`${r.copied ?? 0}개 회차 문구를 가져왔습니다 — 확인 후 각 회차를 저장하세요.`);
  });
  const cancelOne = (brandId: string, name: string) => start(async () => {
    if (!confirm(`${name} 의 남은 안내를 중단할까요?`)) return;
    const r = await cancelSeqAction(brandId, "유입 키 화면에서 중단");
    if (!r.ok) { fail(r.error ?? "실패"); return; }
    const q = await listSeqQueueAction(channelId);
    if (q.ok && q.rows) setRows(q.rows);
    flash(`${r.canceled ?? 0}건 중단됨`);
  });

  const onDays = steps.filter((x) => x.enabled).length;

  return (
    <div style={{ marginTop: 8, padding: 10, border: "1px dashed var(--line)", borderRadius: 8, background: "var(--bg)", display: "grid", gap: 10 }}>
      {(err || loadErr) && (
        <div style={{ border: "1px solid #f3b8b8", background: "#fff5f5", color: "#c92a2a",
                      borderRadius: 8, padding: "8px 10px", fontSize: 12, lineHeight: 1.6 }}>
          <b>⚠️ {err ? "저장되지 않았습니다" : "불러오지 못했습니다"}</b>
          <div style={{ marginTop: 3, wordBreak: "break-all" }}>{err || loadErr}</div>
          <div style={{ marginTop: 3, color: "#a04040" }}>입력한 내용은 화면에 그대로 있습니다 — 원인을 해결한 뒤 다시 「저장」을 눌러 주세요.</div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--ink2)", lineHeight: 1.6 }}>
        이 키로 들어온 리드에게 <b>유입 1일차 · 2일차 …</b> 로 정해진 시각에 보냅니다.
        <b>유입 즉시 발송은 위 「✏️ 내용」(1회성 자동안내)</b>이 그대로 담당하고, 여기는 그다음 날부터입니다.
        꺼진 회차와 문구가 빈 회차는 건너뜁니다. <b>상담·미팅 등 단계가 진전되면 남은 안내는 자동 중단</b>됩니다.
      </div>

      {/* 일정 */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <span className={`tgl ${c.enabled ? "on" : ""}`} onClick={() => canEdit && set("enabled", !c.enabled)} /> <b>연속 안내 사용</b>
        </label>
        <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
          회차
          <select className="f" value={c.days} disabled={!canEdit} onChange={(e) => set("days", Number(e.target.value))} style={{ width: 130 }}>
            {DAY_OPTS.map((d) => <option key={d} value={d}>1~{d}일차</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
          기본 시각
          <select className="f" value={c.hour} disabled={!canEdit} onChange={(e) => set("hour", Number(e.target.value))} style={{ width: 100 }}>
            {HOURS.map((h) => <option key={h} value={h}>{h}시</option>)}
          </select>
        </label>
        <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12 }}>
          <span className={`tgl ${c.stopOnProgress ? "on" : ""}`} onClick={() => canEdit && set("stopOnProgress", !c.stopOnProgress)} /> 단계 진전 시 중단
        </label>
        {canEdit && <button className="btn btn-sm btn-primary" disabled={pending} onClick={saveCfg} style={{ marginLeft: "auto" }}>일정 저장</button>}
        <button className="btn btn-sm" disabled={pending} onClick={preview}>예정표 미리보기</button>
        {canEdit && <button className="btn btn-sm" disabled={pending} onClick={loadApproved}
          title="대표 승인 문안(1~4일차)을 화면에 채웁니다. 저장은 회차별로 눌러야 반영됩니다.">승인 문안 불러오기</button>}
      </div>

      {slots && (
        <div className="note" style={{ fontSize: 11.5 }}>
          <b>지금 이 키로 리드가 들어온다면</b> — {slots.map((x) => `${dayLabel(x.day_no)} ${kst(x.due_at)}`).join(" / ")}
        </div>
      )}

      {/* 문구 복사 */}
      {canEdit && others.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
          <span style={{ color: "var(--ink3)" }}>다른 키 문구 가져오기</span>
          <select className="f" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} style={{ width: 160 }}>
            <option value="">선택…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="btn btn-sm" disabled={pending || !copyFrom} onClick={doCopy}>가져오기</button>
        </div>
      )}

      {/* 일차별 */}
      <div>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginBottom: 5 }}>
          회차별 · 켜진 회차 {onDays}/{steps.length} — 치환변수 <code>{"{브랜드명}"}</code> <code>{"{담당자명}"}</code> <code>{"{일차}"}</code>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          {steps.map((st) => {
            const ready = (st.send_sms && st.sms_body.trim()) || (st.send_email && st.email_body.trim());
            return (
              <div key={st.day_no} style={{ border: "1px solid var(--line)", borderRadius: 6, background: "var(--card)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 8px", flexWrap: "wrap" }}>
                  <span className={`tgl ${st.enabled ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { enabled: !st.enabled })} />
                  <b style={{ fontSize: 12, minWidth: 74 }}>{dayLabel(st.day_no)}</b>
                  <select className="f" disabled={!canEdit} value={st.send_hour == null ? "" : String(st.send_hour)}
                    onChange={(e) => setStep(st.day_no, { send_hour: e.target.value === "" ? null : Number(e.target.value) })}
                    style={{ width: 96, fontSize: 11 }} title="이 회차의 발송 시각(비우면 기본 시각)">
                    <option value="">기본 {c.hour}시</option>
                    {HOURS.map((h) => <option key={h} value={h}>{h}시</option>)}
                  </select>
                  <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11.5 }}>
                    <span className={`tgl ${st.send_sms ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { send_sms: !st.send_sms })} /> 문자
                  </label>
                  <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11.5 }}>
                    <span className={`tgl ${st.send_email ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { send_email: !st.send_email })} /> 메일
                  </label>
                  <span style={{ fontSize: 10.5, color: dirty.has(st.day_no) ? "#c25400" : st.enabled && !ready ? "#c92a2a" : "var(--ink3)" }}>
                    {dirty.has(st.day_no) ? "● 저장 안 됨 — 「저장」을 눌러 주세요"
                      : !st.enabled ? "꺼짐" : ready ? "" : "문구 비어 있음 — 발송 안 됨"}
                  </span>
                  <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenDay(openDay === st.day_no ? null : st.day_no)}>
                    {openDay === st.day_no ? "접기" : "문구"}
                  </button>
                  {canEdit && <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => saveStep(st.day_no)}>저장</button>}
                </div>
                {openDay === st.day_no && (
                  <div style={{ padding: "0 8px 8px", display: "grid", gap: 6 }}>
                    {st.send_sms && (
                      <label className="label" style={{ display: "block" }}>
                        문자 내용 <span style={{ color: "var(--ink3)", fontWeight: 400 }}>{st.sms_body.length}자</span>
                        <textarea className="f" rows={2} disabled={!canEdit} value={st.sms_body}
                          onChange={(e) => setStep(st.day_no, { sms_body: e.target.value })}
                          placeholder="예: [광고] {담당자명}님, 어제 보내드린 자료 보셨을까요? 무료거부 08012345678"
                          style={{ width: "100%", boxSizing: "border-box" }} />
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
                          <textarea className="f" rows={4} disabled={!canEdit} value={st.email_body}
                            onChange={(e) => setStep(st.day_no, { email_body: e.target.value })}
                            style={{ width: "100%", boxSizing: "border-box" }} />
                        </label>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 이 키의 예정·이력 */}
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink3)" }}>이 키의 예정 · 최근 발송</span>
        </div>
        {rows.length === 0 ? (
          <div className="note" style={{ fontSize: 11.5 }}>예약된 안내가 없습니다 — 켠 뒤 이 키로 들어온 리드부터 예약됩니다.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="t" style={{ fontSize: 11, width: "100%" }}>
              <thead><tr><th>브랜드</th><th>일차</th><th>예정</th><th>상태</th><th>메모</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.brand_id}-${r.day_no}-${i}`}>
                    <td><a href={`/brand/${r.brand_id}`}>{r.brand_name}</a></td>
                    <td>{dayLabel(r.day_no)}</td>
                    <td>{kst(r.due_at)}</td>
                    <td>{STATUS_LABEL[r.status] ?? r.status}{r.channels.length ? ` (${r.channels.map((x) => (x === "sms" ? "문자" : "메일")).join("·")})` : ""}</td>
                    <td style={{ color: "var(--ink3)" }}>{r.note}</td>
                    <td>{canEdit && r.status === "queued" && <button className="btn btn-sm" onClick={() => cancelOne(r.brand_id, r.brand_name)} style={{ color: "#e03131" }}>중단</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="note" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
        ⚠️ 연속 발송은 1회성 안내와 달리 <b>광고성 정보</b>로 볼 여지가 큽니다. 문구에 <b>[광고] 표기와 무료 수신거부 방법</b>을
        넣어 주세요(정보통신망법). 이 키가 <b>테스트 모드</b>면 연속 안내도 실제로 보내지 않고 기록만 남습니다.
      </div>
      {msg && <div style={{ fontSize: 11.5, color: "var(--ink2)" }}>{msg}</div>}
    </div>
  );
}
