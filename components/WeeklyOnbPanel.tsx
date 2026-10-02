"use client";
// 온보딩 사전신청 목록 — 직원이 바로 조회하고 연락하는 화면.
//   전화·메일은 직원이 직접 건다(이 화면에서 자동 발송하지 않는다).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  weeklyOverviewAction, weeklySetStatusAction, weeklySetOwnerAction,
  weeklySetNoteAction, weeklyClearTestAction, type WeeklyOverview,
} from "@/app/(dash)/weekly-onboarding/actions";
import { WEEKLY_STATUSES, WEEKLY_STATUS_LABEL, revenueLabel, isLegacyRevenueBand } from "@/lib/weekly-onboarding-model";

type Res = { ok: boolean; error?: string; note?: string };
function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async <T extends Res>(fn: () => Promise<T>, after?: () => void) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.note ?? "완료") : (r.error ?? "처리하지 못했습니다.") });
      if (r.ok) after?.();
      return r;
    } catch (e) {
      setMsg({ ok: false, text: `오류 — ${(e as Error).message}` });
      return { ok: false, error: (e as Error).message } as T;
    } finally { setBusy(false); }
  }, []);
  return { busy, msg, run };
}
const kst = (v: string) => new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
const phoneFmt = (p: string) => (p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}` : p);
const Msg = ({ m }: { m: { ok: boolean; text: string } }) => (
  <div style={{ marginTop: 6, fontSize: 12, color: m.ok ? "#0b7a52" : "#c92a2a" }}>{m.text}</div>
);

export default function WeeklyOnbPanel() {
  const [ov, setOv] = useState<WeeklyOverview | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [showTest, setShowTest] = useState(false);
  const [origin, setOrigin] = useState("");
  const clear = useAction();

  const reload = useCallback(async (withTest: boolean) => {
    setLoading(true);
    const r = await weeklyOverviewAction(withTest);
    setLoading(false);
    if (!r.ok || !r.data) { setErr(r.error ?? "불러오지 못했습니다."); return; }
    setErr(""); setOv(r.data);
  }, []);
  useEffect(() => { void reload(showTest); }, [reload, showTest]);
  useEffect(() => { setOrigin(window.location.origin); }, []);

  if (loading && !ov) return <div className="note">불러오는 중…</div>;
  if (err) return <div className="note" style={{ color: "#c92a2a" }}>{err}</div>;
  if (!ov) return null;
  if (!ov.schemaReady) {
    return (
      <div className="note" style={{ color: "#c25400" }}>
        {ov.schemaError} — 설정 &gt; 마이그레이션에서 <b>{ov.migration}</b> 만 단독 적용하세요.
      </div>
    );
  }

  const url = origin ? `${origin}${ov.formPath}` : ov.formPath;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <div className="hd">
          <b>🔗 신청서 링크</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>이 링크로 들어온 신청만 아래 목록에 쌓입니다.</span>
        </div>
        <div className="bd" style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ fontSize: 12.5 }}>{url}</code>
            <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(url)}>링크 복사</button>
            <a className="btn sm" href={ov.formPath} target="_blank" rel="noreferrer">신청서 열기 ↗</a>
          </div>
          {ov.counts && (
            <div style={{ color: "var(--ink3)", fontSize: 11.5 }}>
              이번 접수주({ov.counts.week}) 접수 <b>{ov.counts.total}</b>건
              {" "}— 접수 수로 자동 마감하거나 선착순을 확정하지 않습니다(담당자가 개별 판단).
            </div>
          )}
        </div>
      </div>

      <div className="card" data-testid="weekly-list">
        <div className="hd">
          <b>📋 틱톡샵 온보딩 신청서 접수</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>
            이 목록은 신청 접수 기록입니다 — 계약·온보딩 단계와는 별개이며 기존 고객 값을 바꾸지 않습니다.
          </span>
        </div>
        <div className="bd" style={{ display: "grid", gap: 10 }}>
          {!ov.revenueReady && (
            <div className="note" style={{ color: "#c25400" }}>
              마이그레이션 <b>{ov.revenueMigration}</b> 미적용 — 신청은 정상 접수되지만
              <b> 새 신청의 매출 구간이 저장되지 않습니다.</b> 설정 &gt; 마이그레이션에서 이 파일만 단독 적용하세요.
            </div>
          )}
          {ov.revenueReady && !ov.bandsReady && (
            <div className="note" style={{ color: "#c25400" }}>
              마이그레이션 <b>{ov.bandsMigration}</b> 미적용 — 신청은 정상 접수되지만
              <b> 바뀐 매출 구간이 저장되지 않습니다(미기입으로 남습니다).</b>
              {" "}설정 &gt; 마이그레이션에서 이 파일만 단독 적용하세요. 이미 저장된 값은 그대로 남습니다.
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
            <label><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> 검수용 TEST 포함</label>
            {ov.canAdmin && showTest && (
              <button className="btn sm" disabled={clear.busy} style={{ color: "#c25400" }}
                onClick={() => { if (confirm("검수용 TEST 데이터만 지웁니다. 실제 신청은 그대로 남습니다.\n진행할까요?")) void clear.run(() => weeklyClearTestAction(), () => reload(showTest)); }}>
                TEST 데이터 지우기
              </button>
            )}
            <span style={{ color: "var(--ink3)" }}>{ov.rows.length}건</span>
          </div>
          {clear.msg && <Msg m={clear.msg} />}

          {ov.rows.length === 0 ? (
            <div className="note">아직 접수된 신청이 없습니다.</div>
          ) : ov.rows.map((r) => (
            <Row key={r.id} r={r} admins={ov.admins} onDone={() => reload(showTest)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ r, admins, onDone }: {
  r: WeeklyOverview["rows"][number]; admins: { id: string; name: string }[]; onDone: () => void;
}) {
  const a = useAction();
  const note = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLSelectElement>(null);
  const owner = useRef<HTMLSelectElement>(null);

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 11, background: r.is_test ? "#fffaf0" : undefined }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        {r.is_test && <span className="cellchip cc-warn">TEST</span>}
        <b>{r.brand_name}</b>
        <span style={{ color: "var(--ink2)" }}>{r.company_name}</span>
        {r.site_url && <a href={r.site_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--acc)" }}>사이트 ↗</a>}
        <span className="chip" style={{ fontSize: 10.5 }}>{WEEKLY_STATUS_LABEL[r.status] ?? r.status}</span>
        <span style={{ marginLeft: "auto", color: "var(--ink3)", fontSize: 11 }}>
          {kst(r.created_at)} · 접수주 {r.week_key}
        </span>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 5, fontSize: 12.5 }}>
        <span>{r.contact_name}{r.contact_title && ` ${r.contact_title}`}</span>
        <a href={`tel:${r.phone}`} style={{ color: "var(--acc)" }}>📞 {phoneFmt(r.phone)}</a>
        <a href={`mailto:${r.email}`} style={{ color: "var(--acc)" }}>✉️ {r.email}</a>
      </div>
      <div style={{ fontSize: 12, marginTop: 5 }}>
        <span style={{ color: "var(--ink3)" }}>자가 기입 매출</span>{" "}
        <b style={{ color: r.revenue_band ? undefined : "var(--ink3)" }}>{revenueLabel(r.revenue_band)}</b>
        {isLegacyRevenueBand(r.revenue_band) && (
          <span className="chip" style={{ marginLeft: 5, fontSize: 10 }} title="폼에서 구간이 바뀌기 전에 접수된 신청입니다 — 값은 그대로 둡니다.">이전 구간</span>
        )}
        <span style={{ color: "var(--ink3)", fontSize: 11 }}> · 신청자가 직접 고른 값(브랜드 원장 매출과 별개)</span>
      </div>
      {r.note && <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 5, whiteSpace: "pre-wrap" }}>문의: {r.note}</div>}

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select className="f" ref={status} defaultValue={r.status} style={{ fontSize: 12 }}
          onChange={() => void a.run(() => weeklySetStatusAction(r.id, status.current?.value ?? r.status), onDone)}>
          {WEEKLY_STATUSES.map((s) => <option key={s} value={s}>{WEEKLY_STATUS_LABEL[s]}</option>)}
        </select>
        <select className="f" ref={owner} defaultValue={r.owner_admin_id ?? ""} style={{ fontSize: 12 }}
          onChange={() => void a.run(() => weeklySetOwnerAction(r.id, owner.current?.value ?? ""), onDone)}>
          <option value="">담당 미지정</option>
          {admins.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input className="f" ref={note} defaultValue={r.admin_note} placeholder="연락 메모"
          style={{ flex: 1, minWidth: 180, fontSize: 12 }} />
        <button className="btn sm" disabled={a.busy}
          onClick={() => void a.run(() => weeklySetNoteAction(r.id, note.current?.value ?? ""), onDone)}>메모 저장</button>
      </div>
      {a.msg && <Msg m={a.msg} />}
    </div>
  );
}
