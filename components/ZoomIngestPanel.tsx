"use client";
// Zoom 수집 운영 카드 — 연동 상태 · 마지막 수집 · 전사 대기 · 미매핑 · 실패 내역 + 안전한 재처리.
//   과거 회의 가져오기는 "미리보기 → 건별 수집"만 제공한다(자동 실행 없음).
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  zoomStatusAction, zoomRetryAction, zoomBackfillPreviewAction, zoomBackfillOneAction, zoomVerifyApiAction,
} from "@/app/(dash)/meetings/zoom-actions";
import { STORED_STAGE_LABEL, type BackfillRow } from "@/lib/zoom-backfill";
import type { ZoomIngestStatus, ZoomFailureRow } from "@/lib/zoom-ingest";

/** 건수 — 조회에 실패하면 0 이 아니라 "확인 실패"로 적는다(0건과 구분). */
const num = (v: number | null) => (v == null ? "확인 실패" : String(v));
const sum2 = (a: number | null, b: number | null) => (a == null || b == null ? "확인 실패" : String(a + b));

const kst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function ZoomIngestPanel({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [st, setSt] = useState<ZoomIngestStatus | null>(null);
  const [fails, setFails] = useState<ZoomFailureRow[]>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<BackfillRow[] | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [pending, start] = useTransition();

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  const load = () => start(async () => {
    setLoadErr("");
    const r = await zoomStatusAction().catch((e) => ({ ok: false, error: (e as Error).message }) as Awaited<ReturnType<typeof zoomStatusAction>>);
    if (r.ok) { setSt(r.status ?? null); setFails(r.failures ?? []); }
    else setLoadErr(r.error ?? "상태를 확인할 수 없습니다.");
  });
  const runVerify = () => start(async () => {
    setVerify(null);
    const r = await zoomVerifyApiAction(host.trim() || undefined);
    setVerify(r.ok
      ? { ok: true, text: "API 호출 확인 — 자격정보·녹화 조회 스코프 정상" }
      : { ok: false, text: `${r.error ?? "검증 실패"}${r.needsApproval ? " · 계정 관리자의 스코프 승인 필요(설정 완료 아님)" : ""}` });
  });
  useEffect(load, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const retry = (kind: "event" | "meeting", id: string) => start(async () => {
    const r = await zoomRetryAction(kind, id);
    flash(r.ok ? (r.note ?? "재처리 완료") : (r.error ?? "재처리 실패"));
    if (r.ok) { load(); router.refresh(); }
  });
  const preview = () => start(async () => {
    setRows(null);
    const r = await zoomBackfillPreviewAction({ host, from, to });
    if (!r.ok) { flash(r.error ?? "조회 실패"); return; }
    setRows(r.rows ?? []); flash(r.note ?? "");
  });
  const pull = (uuid: string) => start(async () => {
    const r = await zoomBackfillOneAction(uuid);
    flash(r.ok ? (r.note ?? "수집 완료") : (r.error ?? "수집 실패"));
    if (r.ok) { load(); router.refresh(); }
  });

  // "연동됨"은 함부로 적지 않는다 — 스키마·시크릿·실제 수신을 각각 따로 본다.
  const headline = st == null ? "확인 중…"
    : st.errors.length > 0 ? "확인 실패"
    : !st.schema.ready ? "스키마 미적용"
    : !st.webhookSecretSet ? "웹훅 시크릿 미설정"
    : !st.receiving ? "웹훅 수신 대기"
    : "수신 중";
  const headlineOk = st != null && st.errors.length === 0 && st.schema.ready && st.webhookSecretSet && st.receiving;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="hd">
        <b>🎥 Zoom 녹화·전사 수집</b>
        <span className={`chip ${headlineOk ? "chip-grn" : "chip-amb"}`} style={{ marginLeft: 8 }}>{headline}</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} disabled={pending} onClick={load}>새로고침</button>
      </div>
      <div className="bd" style={{ display: "grid", gap: 10, fontSize: 12 }}>
        {loadErr && (
          <div data-testid="zoom-load-error" style={{ color: "#c92a2a" }}>
            상태를 확인하지 못했습니다 — {loadErr}
          </div>
        )}
        {st && (
          <>
            {/* ① 환경변수 입력 ② 스키마(0097) ③ 실제 수신 — 셋을 섞어 "연동됨"으로 표시하지 않는다. */}
            <div data-testid="zoom-readiness" style={{ display: "grid", gap: 4 }}>
              <div>
                <b>① 환경변수</b>{" "}
                <span style={{ color: st.envSet ? "#0b7a52" : "#c25400" }}>
                  {st.envSet ? "API 자격정보 입력됨" : "API 자격정보 미입력"}
                </span>
                {" · "}
                <span style={{ color: st.webhookSecretSet ? "#0b7a52" : "#c92a2a" }}>
                  {st.webhookSecretSet ? "웹훅 시크릿 입력됨" : "웹훅 시크릿 미설정 — 웹훅 요청이 거부됩니다"}
                </span>
                <span style={{ color: "var(--ink3)" }}> (입력 여부일 뿐, 동작 확인은 아래 「API 검증」)</span>
              </div>
              <div>
                <b>② 스키마</b>{" "}
                <span style={{ color: st.schema.ready ? "#0b7a52" : "#c92a2a" }}>
                  {st.schema.error ? `확인 실패 — ${st.schema.error}`
                    : st.schema.ready ? "0097 적용됨"
                    : `0097 미적용 — 없는 항목: ${st.schema.missing.join(", ")}`}
                </span>
              </div>
              <div>
                <b>③ 실제 수신</b>{" "}
                <span style={{ color: st.receiving ? "#0b7a52" : "#c25400" }}>
                  {st.receiving ? `웹훅 도착 이력 있음 · 마지막 ${kst(st.lastEventAt)}` : "웹훅 도착 이력 없음 — 아직 녹화 이벤트를 받지 못했습니다"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {canEdit && <button className="btn btn-sm" disabled={pending} onClick={runVerify}>API 검증</button>}
                {verify && (
                  <span data-testid="zoom-verify" style={{ color: verify.ok ? "#0b7a52" : "#c92a2a" }}>{verify.text}</span>
                )}
                {!verify && <span style={{ color: "var(--ink3)" }}>토큰 발급·녹화 조회 스코프를 실제로 호출해 확인합니다(저장·수집 없음).</span>}
              </div>
            </div>

            {st.errors.length > 0 && (
              <div data-testid="zoom-errors" style={{ color: "#c92a2a", lineHeight: 1.7 }}>
                {st.errors.map((e, i) => <div key={i}>· {e}</div>)}
              </div>
            )}

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "var(--ink2)" }}>
              <span>마지막 전사 수집 <b>{kst(st.lastTranscriptAt)}</b></span>
              <span>대기 이벤트 <b>{num(st.queued)}</b></span>
              <span>전사 대기 <b>{num(st.pendingTranscripts)}</b></span>
              <span>녹음만 있음 <b>{num(st.recordingOnly)}</b></span>
              <span style={{ color: (st.failedEvents ?? 0) + (st.failedTranscripts ?? 0) > 0 ? "#c92a2a" : undefined }}>
                실패 <b>{sum2(st.failedEvents, st.failedTranscripts)}</b>
              </span>
              <span style={{ color: (st.unmatched ?? 0) > 0 ? "#c25400" : undefined }}>미매핑 <b>{num(st.unmatched)}</b></span>
            </div>
            {!st.envSet && (
              <div className="note" style={{ fontSize: 11.5 }}>
                · <b>ZOOM_ACCOUNT_ID · ZOOM_CLIENT_ID · ZOOM_CLIENT_SECRET</b> 미입력 — 전사 파일 내려받기·과거 가져오기를 쓸 수 없습니다(웹훅으로 받은 건은 24시간 내에는 수집 가능).
              </div>
            )}
          </>
        )}

        {/* 실패·대기 내역 */}
        {fails.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="t" style={{ fontSize: 11.5, width: "100%" }}>
              <thead><tr><th>구분</th><th>대상</th><th>사유</th><th>시각</th><th /></tr></thead>
              <tbody>
                {fails.map((f) => (
                  <tr key={`${f.kind}-${f.id}`}>
                    <td>{f.kind === "event" ? "웹훅" : "회의"}</td>
                    <td>{f.kind === "meeting" ? <a href={`/meetings`}>{f.label}</a> : f.label}</td>
                    <td style={{ color: "var(--ink3)" }}>{f.detail}</td>
                    <td>{kst(f.at)}</td>
                    <td>{canEdit && <button className="btn btn-sm" disabled={pending} onClick={() => retry(f.kind, f.id)}>재처리</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 과거 가져오기 — 미리보기 먼저 */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>{open ? "접기" : "과거 회의 가져오기"}</button>
          {open && (
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <div style={{ color: "var(--ink3)", fontSize: 11.5 }}>
                호스트와 기간을 정해 <b>무엇이 들어올지 먼저 봅니다</b>. 미리보기만으로는 아무것도 저장되지 않고,
                목록에서 「가져오기」를 누른 회의만 수집됩니다.
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input className="f" value={host} onChange={(e) => setHost(e.target.value)} placeholder="호스트 줌 계정 이메일" style={{ width: 210 }} />
                <input className="f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
                <span style={{ color: "var(--ink3)" }}>~</span>
                <input className="f" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
                <button className="btn btn-sm btn-primary" disabled={pending} onClick={preview}>미리보기</button>
              </div>
              {rows && rows.length === 0 && <div className="note" style={{ fontSize: 12 }}>해당 기간에 녹화가 없습니다.</div>}
              {rows && rows.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="t" style={{ fontSize: 11.5, width: "100%" }}>
                    <thead><tr><th>시작</th><th>제목</th><th>길이</th><th>전사</th><th>상태</th><th /></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.uuid}>
                          <td>{kst(r.startTime)}</td>
                          <td>{r.topic || "(제목 없음)"}</td>
                          <td>{r.durationMin}분</td>
                          <td>{r.hasTranscript ? "있음" : <span style={{ color: "#c25400" }}>녹음만</span>}</td>
                          <td>
                            <span style={{ color: r.stored === "transcript" ? "#0b7a52" : r.stored === "none" ? "var(--ink3)" : "#c25400" }}>
                              {STORED_STAGE_LABEL[r.stored]}
                            </span>
                            {r.brandName ? ` · ${r.brandName}` : ""}
                          </td>
                          <td>{canEdit && <button className="btn btn-sm" disabled={pending} onClick={() => pull(r.uuid)}>가져오기</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {msg && <div style={{ color: "var(--ink2)" }}>{msg}</div>}
      </div>
    </div>
  );
}
