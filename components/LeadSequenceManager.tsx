"use client";
// 유입 루트별 연속 안내(드립) — 소스마다 며칠간 · 몇 시에 · 일차별 어떤 문구로 보낼지.
//   화면: /channels(유입 소스·자동발송). 1회성 자동안내와 같은 자리에 둔다.
import { useState, useTransition } from "react";
import type { SeqConfig, SeqStep, SeqQueueRow } from "@/lib/lead-sequence";
import type { IntakeSource } from "@/lib/intake-sources";
import {
  saveSeqConfigAction, saveSeqStepAction, listSeqStepsAction, listSeqQueueAction,
  previewSeqScheduleAction, copySeqStepsAction, runSeqNowAction, cancelSeqAction,
} from "@/app/(dash)/channels/sequence-actions";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_OPTS = [3, 5, 7, 10, 14, 21, 30];
// 한국시간으로 보여준다 — 서버·브라우저 표준시와 무관하게 실제 발송 시각이 헷갈리지 않게.
const kst = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
const STATUS_LABEL: Record<string, string> = { queued: "예정", sent: "발송됨", failed: "실패", skipped: "건너뜀", canceled: "중단" };

export default function LeadSequenceManager({ sources, configs, canEdit, channelCounts }: {
  sources: IntakeSource[];
  configs: Record<string, SeqConfig>;
  canEdit: boolean;
  channelCounts: Record<string, number>;   // 소스별 등록된 유입 루트(채널) 수
}) {
  const [cfgs, setCfgs] = useState(configs);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [steps, setSteps] = useState<SeqStep[]>([]);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [rows, setRows] = useState<SeqQueueRow[]>([]);
  const [slots, setSlots] = useState<{ day_no: number; due_at: string }[] | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };
  const cfgOf = (key: string): SeqConfig =>
    cfgs[key] ?? { source_key: key, enabled: false, days: 7, hour: 10, day1Immediate: true, skipWeekend: false, stopOnProgress: true };
  const setCfg = <K extends keyof SeqConfig>(key: string, k: K, v: SeqConfig[K]) =>
    setCfgs((p) => ({ ...p, [key]: { ...cfgOf(key), [k]: v } }));
  const setStep = (day: number, patch: Partial<SeqStep>) =>
    setSteps((p) => p.map((x) => (x.day_no === day ? { ...x, ...patch } : x)));

  const open = (key: string) => start(async () => {
    if (openKey === key) { setOpenKey(null); return; }
    setOpenKey(key); setOpenDay(null); setSlots(null); setCopyFrom("");
    const [s, q] = await Promise.all([listSeqStepsAction(key, cfgOf(key).days), listSeqQueueAction(key)]);
    setSteps(s.ok && s.steps ? s.steps : []);
    setRows(q.ok && q.rows ? q.rows : []);
  });
  const saveCfg = (key: string) => start(async () => {
    const r = await saveSeqConfigAction(cfgOf(key));
    if (!r.ok) { flash(r.error ?? "저장 실패"); return; }
    const s = await listSeqStepsAction(key, cfgOf(key).days);   // 기간이 바뀌면 일차 수도 달라진다
    if (s.ok && s.steps) setSteps(s.steps);
    flash("일정 저장됨 ✓");
  });
  const saveStep = (day: number) => start(async () => {
    const step = steps.find((x) => x.day_no === day);
    if (!step) return;
    const r = await saveSeqStepAction(step);
    flash(r.ok ? `${day}일차 저장됨 ✓` : r.error ?? "저장 실패");
  });
  const preview = (key: string) => start(async () => {
    const r = await previewSeqScheduleAction(cfgOf(key));
    if (r.ok && r.slots) { setSlots(r.slots); flash("지금 이 루트로 리드가 들어왔다고 가정한 예정표입니다(발송 아님)"); }
  });
  const doCopy = (key: string) => start(async () => {
    const r = await copySeqStepsAction(copyFrom, key);
    if (!r.ok) { flash(r.error ?? "복사 실패"); return; }
    const s = await listSeqStepsAction(key, cfgOf(key).days);
    if (s.ok && s.steps) setSteps(s.steps);
    flash(`${r.copied ?? 0}개 일차 문구를 가져왔습니다 — 확인 후 각 일차를 저장하세요.`);
  });
  const runNow = () => start(async () => {
    if (!confirm("예정 시각이 지난 안내를 지금 발송합니다(모든 유입 루트). 진행할까요?")) return;
    const r = await runSeqNowAction();
    if (!r.ok) { flash(r.error ?? "실행 실패"); return; }
    if (openKey) { const q = await listSeqQueueAction(openKey); if (q.ok && q.rows) setRows(q.rows); }
    flash(r.summary ?? "완료");
  });
  const cancelOne = (brandId: string, name: string) => start(async () => {
    if (!confirm(`${name} 의 남은 안내를 중단할까요?`)) return;
    const r = await cancelSeqAction(brandId, "유입 소스 화면에서 중단");
    if (!r.ok) { flash(r.error ?? "실패"); return; }
    if (openKey) { const q = await listSeqQueueAction(openKey); if (q.ok && q.rows) setRows(q.rows); }
    flash(`${r.canceled ?? 0}건 중단됨`);
  });

  const onCount = sources.filter((s) => cfgOf(s.key).enabled).length;

  return (
    <div className="card">
      <div className="card-hd">
        <b>유입 루트별 연속 안내 — 일차별 문자·메일</b>
        <span className="chip" style={{ marginLeft: "auto" }}>{onCount}개 루트 사용 중</span>
        {canEdit && <button className="btn btn-sm" disabled={pending} onClick={runNow} title="크론을 기다리지 않고 예정분을 지금 처리">예정분 지금 발송</button>}
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.6 }}>
          유입 루트(소스)마다 <b>기간·발송 시각·일차별 문구</b>를 따로 설정합니다. 예) 메타 광고는 7일, 전시·팝업은 3일.
          1회성 자동안내가 나간 뒤 다음 날부터 매일 지정 시각에 이어서 발송되고,
          <b> 상담·미팅 등 단계가 진전되면 남은 안내는 자동 중단</b>됩니다.
        </div>

        {sources.map((s) => {
          const c = cfgOf(s.key);
          const isOpen = openKey === s.key;
          return (
            <div key={s.key} style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
              {/* 소스 한 줄 */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", flexWrap: "wrap" }}>
                <span className={`tgl ${c.enabled ? "on" : ""}`} onClick={() => canEdit && setCfg(s.key, "enabled", !c.enabled)} />
                <b style={{ fontSize: 13 }}>{s.label}</b>
                <span style={{ fontSize: 11, color: "var(--ink3)" }}>
                  {s.key}{channelCounts[s.key] ? ` · 등록 루트 ${channelCounts[s.key]}개` : ""}
                  {!s.enabled ? " · 소스 비활성" : ""}
                </span>
                <span className={`chip ${c.enabled ? "chip-grn" : "chip-amb"}`} style={{ fontSize: 11 }}>
                  {c.enabled ? `${c.days}일 · 매일 ${c.hour}시` : "연속 안내 OFF"}
                </span>
                <button className="btn btn-sm" style={{ marginLeft: "auto" }} disabled={pending} onClick={() => open(s.key)}>
                  {isOpen ? "접기" : "설정·문구"}
                </button>
              </div>

              {isOpen && (
                <div style={{ padding: "0 10px 12px", display: "grid", gap: 12, borderTop: "1px solid var(--line)" }}>
                  {/* 일정 */}
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", paddingTop: 10 }}>
                    <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                      기간
                      <select className="f" value={c.days} disabled={!canEdit} onChange={(e) => setCfg(s.key, "days", Number(e.target.value))} style={{ width: 84 }}>
                        {DAY_OPTS.map((d) => <option key={d} value={d}>{d}일</option>)}
                      </select>
                    </label>
                    <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                      발송 시각
                      <select className="f" value={c.hour} disabled={!canEdit} onChange={(e) => setCfg(s.key, "hour", Number(e.target.value))} style={{ width: 104 }}>
                        {HOURS.map((h) => <option key={h} value={h}>{h}시 (KST)</option>)}
                      </select>
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                      <span className={`tgl ${c.day1Immediate ? "on" : ""}`} onClick={() => canEdit && setCfg(s.key, "day1Immediate", !c.day1Immediate)} /> 1일차는 유입 즉시
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                      <span className={`tgl ${c.skipWeekend ? "on" : ""}`} onClick={() => canEdit && setCfg(s.key, "skipWeekend", !c.skipWeekend)} /> 주말 건너뛰기
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                      <span className={`tgl ${c.stopOnProgress ? "on" : ""}`} onClick={() => canEdit && setCfg(s.key, "stopOnProgress", !c.stopOnProgress)} /> 단계 진전 시 중단
                    </label>
                    {canEdit && <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => saveCfg(s.key)}>일정 저장</button>}
                    <button className="btn btn-sm" disabled={pending} onClick={() => preview(s.key)}>예정표 미리보기</button>
                  </div>

                  {slots && (
                    <div className="note" style={{ fontSize: 12 }}>
                      <b>지금 이 루트로 리드가 들어온다면</b> — {slots.map((x) => `${x.day_no}일차 ${kst(x.due_at)}`).join(" / ")}
                    </div>
                  )}

                  {/* 다른 루트 문구 가져오기 */}
                  {canEdit && sources.length > 1 && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                      <span style={{ color: "var(--ink3)" }}>다른 루트 문구 가져오기</span>
                      <select className="f" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} style={{ width: 160 }}>
                        <option value="">선택…</option>
                        {sources.filter((x) => x.key !== s.key).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                      <button className="btn btn-sm" disabled={pending || !copyFrom} onClick={() => doCopy(s.key)}>가져오기</button>
                    </div>
                  )}

                  {/* 일차별 문구 */}
                  <div>
                    <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 6 }}>
                      일차별 문구 — 치환변수 <code>{"{브랜드명}"}</code> <code>{"{담당자명}"}</code> <code>{"{일차}"}</code>
                    </div>
                    <div style={{ display: "grid", gap: 5 }}>
                      {steps.map((st) => {
                        const ready = (st.send_sms && st.sms_body.trim()) || (st.send_email && st.email_body.trim());
                        return (
                          <div key={st.day_no} style={{ border: "1px solid var(--line)", borderRadius: 7 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 9px", flexWrap: "wrap" }}>
                              <span className={`tgl ${st.enabled ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { enabled: !st.enabled })} />
                              <b style={{ fontSize: 12.5, minWidth: 50 }}>{st.day_no}일차</b>
                              <span style={{ fontSize: 11, color: st.enabled && !ready ? "#c92a2a" : "var(--ink3)" }}>
                                {!st.enabled ? "꺼짐 — 이 날은 건너뜁니다"
                                  : ready ? `${st.send_sms && st.sms_body.trim() ? "문자" : ""}${st.send_sms && st.sms_body.trim() && st.send_email && st.email_body.trim() ? "·" : ""}${st.send_email && st.email_body.trim() ? "메일" : ""} 발송`
                                  : "문구가 비어 있어 발송되지 않습니다"}
                              </span>
                              <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenDay(openDay === st.day_no ? null : st.day_no)}>
                                {openDay === st.day_no ? "접기" : "문구 편집"}
                              </button>
                            </div>
                            {openDay === st.day_no && (
                              <div style={{ padding: "0 9px 9px", display: "grid", gap: 7 }}>
                                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                                    <span className={`tgl ${st.send_sms ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { send_sms: !st.send_sms })} /> 문자
                                  </label>
                                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                                    <span className={`tgl ${st.send_email ? "on" : ""}`} onClick={() => canEdit && setStep(st.day_no, { send_email: !st.send_email })} /> 이메일
                                  </label>
                                </div>
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

                  {/* 이 루트의 예정·이력 */}
                  <div>
                    <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 6 }}>이 루트의 예정 · 최근 발송</div>
                    {rows.length === 0 ? (
                      <div className="note" style={{ fontSize: 12 }}>예약된 안내가 없습니다 — 켠 뒤 이 루트로 들어온 리드부터 예약됩니다.</div>
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
                </div>
              )}
            </div>
          );
        })}

        <div className="note" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
          ⚠️ 연속 발송은 1회성 안내와 달리 <b>광고성 정보</b>로 볼 여지가 큽니다. 문자·메일 문구에
          <b> [광고] 표기와 무료 수신거부 방법</b>을 넣어 주세요(정보통신망법). 수신거부 요청이 오면 위 표에서 「중단」을 눌러 주세요.
        </div>
        {msg && <div style={{ fontSize: 12, color: "var(--ink2)" }}>{msg}</div>}
      </div>
    </div>
  );
}
