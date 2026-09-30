"use client";
// 주간 세미나 안내 자동발송 운영 화면.
//   · 지금 보낼 수 있는 상태인지(차단 사유)를 맨 위에 그대로 보여준다.
//   · 대상 미리보기는 DB 를 바꾸지 않는다. "대상 확정"을 눌러야 예약이 생긴다.
//   · 입력은 모두 ref + defaultValue — 값을 프로그램으로 채워도 저장에서 빠지지 않게.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  seminarOverviewAction, seminarSaveConfigAction, seminarSaveTemplateAction,
  seminarPreviewAction, seminarBuildAction, seminarDispatchAction, seminarSessionDetailAction,
  type SeminarOverview,
} from "@/app/(dash)/seminar/actions";
import type { PreviewResult, SendRow, TargetRow } from "@/lib/seminar";

type Res = { ok: boolean; error?: string; note?: string };

function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async <T extends Res>(fn: () => Promise<T>, after?: (r: T) => void) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.note ?? "완료") : (r.error ?? "처리하지 못했습니다.") });
      if (r.ok) after?.(r);
      return r;
    } catch (e) {
      setMsg({ ok: false, text: `오류 — ${(e as Error).message}` });
      return { ok: false, error: (e as Error).message } as T;
    } finally { setBusy(false); }
  }, []);
  return { busy, msg, setMsg, run };
}

const num = (r: React.RefObject<HTMLInputElement | HTMLSelectElement | null>, fb: number) => {
  const v = Number(r.current?.value);
  return Number.isFinite(v) ? v : fb;
};
const str = (r: React.RefObject<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>, fb: string) => {
  const v = r.current?.value;
  return typeof v === "string" ? v : fb;
};
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false }) : "—");

const STATUS_KO: Record<string, string> = {
  queued: "발송 예정", sending: "발송 중", sent: "발송 완료", failed: "실패",
  skipped: "제외", canceled: "취소",
};
const TSTATUS_KO: Record<string, string> = {
  eligible: "대상", duplicate: "중복", excluded: "제외", deferred: "다음 회차 이월",
};

export default function SeminarPanel() {
  const [ov, setOv] = useState<SeminarOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await seminarOverviewAction();
    setLoading(false);
    if (!r.ok || !r.data) { setLoadError(r.error ?? "불러오지 못했습니다."); return; }
    setLoadError(""); setOv(r.data);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  if (loading && !ov) return <div className="note">불러오는 중…</div>;
  if (loadError) return <div className="note" style={{ color: "#c92a2a" }}>{loadError}</div>;
  if (!ov) return null;

  if (!ov.schemaReady) {
    return (
      <div className="note" style={{ color: "#c25400" }}>
        {ov.schemaError} — 설정 &gt; 마이그레이션에서 <b>{ov.migration}</b> 만 단독 적용하면 사용할 수 있습니다.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <StatusCard ov={ov} onDone={reload} />
      <ConfigCard ov={ov} onDone={reload} />
      <TemplatesCard ov={ov} onDone={reload} />
      <PreviewCard ov={ov} onDone={reload} />
      <SessionsCard ov={ov} />
      <RunsCard ov={ov} />
    </div>
  );
}

// ── 상태 ────────────────────────────────────────────────────
function StatusCard({ ov, onDone }: { ov: SeminarOverview; onDone: () => void }) {
  const cfg = ov.config!;
  const a = useAction();
  const blockers: string[] = [];
  if (!cfg.enabled) blockers.push("자동발송 마스터 스위치가 꺼져 있습니다");
  if (!/^https?:\/\//i.test(cfg.zoomUrl)) blockers.push("고정 Zoom 링크가 설정되지 않았습니다");
  for (const t of ov.templates) if (!t.enabled) blockers.push(`${t.stage === "notice" ? "안내" : "후속"} 문구가 아직 초안(비활성)입니다`);

  return (
    <div className="card" data-testid="seminar-status">
      <div className="hd">
        <b>🎓 주간 세미나 안내 자동발송</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          그 주에 새로 들어온 세미나 신청에게만 보냅니다 — 누적 리드·다른 유입 루트·테스트 리드는 제외됩니다.
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className={`cellchip ${cfg.enabled ? "cc-ok" : "cc-no"}`} data-testid="seminar-master">
            실제 발송 {cfg.enabled ? "ON" : "OFF"}
          </span>
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>다음 회차 {ov.upcoming || "—"}</span>
          {ov.canWrite && (
            <button className="btn sm" disabled={a.busy}
              onClick={() => {
                if (!cfg.enabled && !confirm(
                  "자동발송을 켭니다. 이후 예정 시각이 되면 실제 고객에게 문자·메일이 나갑니다.\n" +
                  "Zoom 링크와 문구를 확인했나요?")) return;
                void a.run(() => seminarSaveConfigAction({ enabled: !cfg.enabled }), onDone);
              }}
              style={{ color: cfg.enabled ? "#c25400" : "#0b7a52" }}>
              {cfg.enabled ? "발송 끄기" : "발송 켜기"}
            </button>
          )}
          {ov.canWrite && (
            <button className="btn sm" disabled={a.busy}
              onClick={() => { if (confirm("예정 시각이 지난 예약을 지금 처리합니다. 진행할까요?")) void a.run(async () => { const r = await seminarDispatchAction(); return { ...r, note: `대상 ${r.due} · 발송 ${r.sent} · 실패 ${r.failed} · 제외 ${r.skipped} · 재시도 ${r.retry}${r.blocked?.length ? ` · ${r.blocked.join(" · ")}` : ""}` }; }, onDone); }}>
              지금 처리
            </button>
          )}
        </div>
        {blockers.length > 0 ? (
          <div className="note" style={{ color: "#c25400" }} data-testid="seminar-blockers">
            지금은 보내지 않습니다 — {blockers.join(" · ")}
          </div>
        ) : (
          <div className="note" style={{ color: "#0b7a52" }}>보낼 수 있는 상태입니다.</div>
        )}
        {a.msg && <Msg m={a.msg} />}
      </div>
    </div>
  );
}

// ── 설정 ────────────────────────────────────────────────────
function ConfigCard({ ov, onDone }: { ov: SeminarOverview; onDone: () => void }) {
  const cfg = ov.config!;
  const a = useAction();
  const zoom = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const sources = useRef<HTMLInputElement>(null);
  const weekMode = useRef<HTMLSelectElement>(null);
  const sh = useRef<HTMLInputElement>(null), sm = useRef<HTMLInputElement>(null);
  const fh = useRef<HTMLInputElement>(null), fm = useRef<HTMLInputElement>(null);
  const nd = useRef<HTMLInputElement>(null), nh = useRef<HTMLInputElement>(null), nm = useRef<HTMLInputElement>(null);
  const cut = useRef<HTMLInputElement>(null);
  const late = useRef<HTMLSelectElement>(null);
  const dedupe = useRef<HTMLSelectElement>(null);
  const stale = useRef<HTMLInputElement>(null);
  const tries = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(cfg.sendEmail);
  const [sms, setSms] = useState(cfg.sendSms);

  function save() {
    void a.run(() => seminarSaveConfigAction({
      zoomUrl: str(zoom, cfg.zoomUrl).trim(),
      sessionTitle: str(title, cfg.sessionTitle).trim(),
      firstSessionDate: str(first, cfg.firstSessionDate).trim(),
      sourceKeys: str(sources, cfg.sourceKeys.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
      weekMode: str(weekMode, cfg.weekMode) as "session_to_session" | "calendar_week",
      sessionHour: num(sh, cfg.sessionHour), sessionMinute: num(sm, cfg.sessionMinute),
      followupHour: num(fh, cfg.followupHour), followupMinute: num(fm, cfg.followupMinute),
      noticeLeadDays: num(nd, cfg.noticeLeadDays), noticeHour: num(nh, cfg.noticeHour), noticeMinute: num(nm, cfg.noticeMinute),
      cutoffMinutes: num(cut, cfg.cutoffMinutes),
      latePolicy: str(late, cfg.latePolicy) as "send_now" | "next_week" | "skip",
      dedupeScope: str(dedupe, cfg.dedupeScope) as "contact" | "brand",
      staleHours: num(stale, cfg.staleHours), maxAttempts: num(tries, cfg.maxAttempts),
      sendEmail: email, sendSms: sms,
    }), onDone);
  }

  const ro = !ov.canWrite;
  return (
    <div className="card">
      <div className="hd"><b>⚙️ 발송 조건</b><span style={{ color: "var(--ink3)", fontSize: 11 }}>모두 KST 기준</span></div>
      <div className="bd" style={{ display: "grid", gap: 10 }}>
        <Field label="고정 Zoom 링크" hint="비어 있으면 어떤 경우에도 보내지 않습니다(없는 링크를 지어내지 않습니다).">
          <input className="f" ref={zoom} defaultValue={cfg.zoomUrl} disabled={ro}
            placeholder="https://zoom.us/j/… (별도 확인 중)" style={{ width: 420, maxWidth: "100%" }} />
        </Field>
        <Field label="세미나 제목" hint="안내 문구의 {{세미나명}} 자리에 들어갑니다.">
          <input className="f" ref={title} defaultValue={cfg.sessionTitle} disabled={ro} style={{ width: 420, maxWidth: "100%" }} />
        </Field>
        <Field label="첫 회차 날짜" hint="이 날짜 이전 회차는 만들지 않습니다.">
          <input className="f" ref={first} type="date" defaultValue={cfg.firstSessionDate} disabled={ro} style={{ width: 170 }} />
        </Field>
        <Field label="세미나 신청으로 볼 유입 소스" hint="쉼표로 구분. 여기 없는 소스로 들어온 리드는 대상이 아닙니다.">
          <input className="f" ref={sources} defaultValue={cfg.sourceKeys.join(",")} disabled={ro} style={{ width: 320 }} />
        </Field>
        <Field label="주간 경계" hint="확정 전까지 바꿔 끼울 수 있습니다. 두 방식 모두 회차끼리 구간이 맞닿아 누락·중복이 없습니다.">
          <select className="f" ref={weekMode} defaultValue={cfg.weekMode} disabled={ro} style={{ width: 420 }}>
            <option value="session_to_session">A · 지난 월 10:30 ~ 이번 월 10:30 직전(회차→회차)</option>
            <option value="calendar_week">B · 지난 월 00:00 ~ 일 23:59(달력 주)</option>
          </select>
        </Field>
        <Field label="회차 시각">
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>1차</span>
          <input className="f" ref={sh} defaultValue={String(cfg.sessionHour)} disabled={ro} style={{ width: 56 }} />:
          <input className="f" ref={sm} defaultValue={String(cfg.sessionMinute)} disabled={ro} style={{ width: 56 }} />
          <span style={{ fontSize: 12, color: "var(--ink3)", marginLeft: 10 }}>2차</span>
          <input className="f" ref={fh} defaultValue={String(cfg.followupHour)} disabled={ro} style={{ width: 56 }} />:
          <input className="f" ref={fm} defaultValue={String(cfg.followupMinute)} disabled={ro} style={{ width: 56 }} />
        </Field>
        <Field label="안내 발송 시각" hint="회차 며칠 전 · 몇 시 몇 분에 1차 안내를 보낼지. 2차 안내는 2차 시작 시각에 보냅니다.">
          <input className="f" ref={nd} defaultValue={String(cfg.noticeLeadDays)} disabled={ro} style={{ width: 56 }} />
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>일 전</span>
          <input className="f" ref={nh} defaultValue={String(cfg.noticeHour)} disabled={ro} style={{ width: 56 }} />:
          <input className="f" ref={nm} defaultValue={String(cfg.noticeMinute)} disabled={ro} style={{ width: 56 }} />
        </Field>
        <Field label="접수 마감(회차 시작 전)" hint="이 시간 이후 신청은 다음 회차 대상이 됩니다.">
          <input className="f" ref={cut} defaultValue={String(cfg.cutoffMinutes)} disabled={ro} style={{ width: 70 }} />
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>분</span>
        </Field>
        <Field label="늦은 신청 처리" hint="안내 발송이 끝난 뒤 들어온 신청. 어떤 경우에도 두 번 보내지는 않습니다.">
          <select className="f" ref={late} defaultValue={cfg.latePolicy} disabled={ro} style={{ width: 420 }}>
            <option value="send_now">확인 즉시 1회 안내(회차 시작 전까지만)</option>
            <option value="next_week">다음 회차로 이월</option>
            <option value="skip">자동 안내 제외(수동 처리)</option>
          </select>
        </Field>
        <Field label="중복 판정 기준" hint="한 회차 안에서 같은 수신자에게 두 번 보내지 않기 위한 기준입니다.">
          <select className="f" ref={dedupe} defaultValue={cfg.dedupeScope} disabled={ro} style={{ width: 420 }}>
            <option value="contact">연락처 단위 — 같은 팀이라도 참석자가 다르면 각자 받음</option>
            <option value="brand">팀(브랜드) 단위 — 한 팀에 1건만</option>
          </select>
        </Field>
        <Field label="채널">
          <label style={{ fontSize: 12.5 }}>
            <input type="checkbox" checked={email} disabled={ro} onChange={(e) => setEmail(e.target.checked)} /> 메일
          </label>
          <label style={{ fontSize: 12.5, marginLeft: 10 }}>
            <input type="checkbox" checked={sms} disabled={ro} onChange={(e) => setSms(e.target.checked)} /> 문자
          </label>
        </Field>
        <Field label="재시도·묵은 예약" hint="예정 시각이 지난 지 오래된 예약은 보내지 않습니다(스위치를 켠 순간 묵은 안내가 쏟아지는 것 방지).">
          <input className="f" ref={tries} defaultValue={String(cfg.maxAttempts)} disabled={ro} style={{ width: 56 }} />
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>회 시도</span>
          <input className="f" ref={stale} defaultValue={String(cfg.staleHours)} disabled={ro} style={{ width: 56, marginLeft: 10 }} />
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>시간 지나면 발송 안 함</span>
        </Field>
        {!ro && <div><button className="btn sm pri" disabled={a.busy} onClick={save}>{a.busy ? "저장 중…" : "설정 저장"}</button></div>}
        {a.msg && <Msg m={a.msg} />}
        <div style={{ fontSize: 11.5, color: "var(--ink3)" }}>
          마지막 수정 {kst(cfg.updatedAt)} {cfg.updatedBy ? `· ${cfg.updatedBy}` : ""}
        </div>
      </div>
    </div>
  );
}

// ── 문구 ────────────────────────────────────────────────────
function TemplatesCard({ ov, onDone }: { ov: SeminarOverview; onDone: () => void }) {
  return (
    <div className="card">
      <div className="hd">
        <b>✉️ 발송 문구</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>
          치환: {"{{브랜드명}} {{담당자명}} {{일시}} {{줌링크}} {{세미나명}}"} · 기존 세미나 문안이 없어 초안으로 넣어 두었습니다(비활성).
        </span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 12 }}>
        {ov.templates.map((t) => <TemplateRow key={t.stage} t={t} canWrite={ov.canWrite} onDone={onDone} />)}
      </div>
    </div>
  );
}

function TemplateRow({ t, canWrite, onDone }: { t: SeminarOverview["templates"][number]; canWrite: boolean; onDone: () => void }) {
  const a = useAction();
  const subj = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const sms = useRef<HTMLTextAreaElement>(null);
  const [purpose, setPurpose] = useState(t.purpose);
  const [useEmail, setUseEmail] = useState(t.sendEmail);
  const [useSms, setUseSms] = useState(t.sendSms);
  const ro = !canWrite;

  const save = (enable?: boolean) => {
    void a.run(() => seminarSaveTemplateAction(t.stage, {
      emailSubject: str(subj, t.emailSubject), emailBody: str(body, t.emailBody), smsBody: str(sms, t.smsBody),
      purpose, sendEmail: useEmail, sendSms: useSms,
      ...(enable === undefined ? {} : { enabled: enable }),
    }), onDone);
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{t.stage === "notice" ? "1차 · 세미나 참가 안내" : "2차 · 후속 세미나 내용"}</b>
        <span className={`cellchip ${t.enabled ? "cc-ok" : "cc-warn"}`}>{t.enabled ? "활성" : "초안(발송 안 함)"}</span>
        <select className="f" value={purpose} disabled={ro} onChange={(e) => setPurpose(e.target.value as "service" | "ad")}
          style={{ fontSize: 12 }}
          title="서비스 안내는 광고 수신거부를 적용하지 않습니다. 광고성이면 기존 광고 수신거부 규칙과 수신거부 링크가 그대로 적용됩니다.">
          <option value="service">서비스 안내(신청한 세미나 참가 안내)</option>
          <option value="ad">광고성 — 광고 수신거부 적용</option>
        </select>
        <label style={{ fontSize: 12.5 }}>
          <input type="checkbox" checked={useEmail} disabled={ro} onChange={(e) => setUseEmail(e.target.checked)} /> 메일
        </label>
        <label style={{ fontSize: 12.5 }}>
          <input type="checkbox" checked={useSms} disabled={ro} onChange={(e) => setUseSms(e.target.checked)} /> 문자
        </label>
        {!ro && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button className="btn sm" disabled={a.busy} onClick={() => save()}>저장</button>
            <button className="btn sm" disabled={a.busy}
              onClick={() => {
                if (!t.enabled && !confirm("이 문구를 활성화합니다. 마스터 스위치가 켜져 있으면 예정 시각에 실제로 나갑니다.\n진행할까요?")) return;
                save(!t.enabled);
              }}
              style={{ color: t.enabled ? "#c25400" : "#0b7a52" }}>
              {t.enabled ? "비활성" : "활성화"}
            </button>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        <input className="f" ref={subj} defaultValue={t.emailSubject} disabled={ro} placeholder="메일 제목" style={{ fontSize: 13 }} />
        <textarea className="f" ref={body} defaultValue={t.emailBody} disabled={ro} rows={7} placeholder="메일 본문" style={{ fontSize: 13 }} />
        <textarea className="f" ref={sms} defaultValue={t.smsBody} disabled={ro} rows={3} placeholder="문자 본문" style={{ fontSize: 13 }} />
      </div>
      {a.msg && <Msg m={a.msg} />}
    </div>
  );
}

// ── 대상 미리보기 ───────────────────────────────────────────
function PreviewCard({ ov, onDone }: { ov: SeminarOverview; onDone: () => void }) {
  const day = useRef<HTMLInputElement>(null);
  const a = useAction();
  const b = useAction();
  const [pv, setPv] = useState<PreviewResult | null>(null);

  const counts = (s: string) => (pv?.targets ?? []).filter((t) => t.status === s).length;

  return (
    <div className="card" data-testid="seminar-preview">
      <div className="hd">
        <b>👥 대상 미리보기</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>미리보기는 DB 를 바꾸지 않습니다 — 예약은 “대상 확정”에서 생깁니다.</span>
      </div>
      <div className="bd" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>회차 날짜</span>
          <input className="f" ref={day} defaultValue={ov.upcoming} placeholder="YYYY-MM-DD" style={{ width: 150 }} />
          <button className="btn sm" disabled={a.busy}
            onClick={() => void a.run(async () => {
              const r = await seminarPreviewAction(str(day, ov.upcoming));
              if (r.ok && r.data) setPv(r.data);
              return { ...r, note: r.ok ? "대상을 계산했습니다." : undefined };
            })}>
            {a.busy ? "계산 중…" : "미리보기"}
          </button>
          {ov.canWrite && (
            <button className="btn sm pri" disabled={b.busy}
              onClick={() => {
                if (!confirm("이 회차의 대상 명단과 발송 예약을 만듭니다. 지금 보내지는 않습니다.\n진행할까요?")) return;
                void b.run(async () => {
                  const r = await seminarBuildAction(str(day, ov.upcoming));
                  return { ...r, note: r.ok ? `대상 ${r.eligible ?? 0} · 중복 ${r.duplicate ?? 0} · 제외 ${r.excluded ?? 0} · 이월 ${r.deferred ?? 0} · 예약 생성 ${r.queued ?? 0}` : undefined };
                }, onDone);
              }}>
              {b.busy ? "확정 중…" : "대상 확정 · 예약 생성"}
            </button>
          )}
        </div>
        {a.msg && <Msg m={a.msg} />}
        {b.msg && <Msg m={b.msg} />}

        {pv && (
          <>
            <div style={{ fontSize: 12, color: "var(--ink2)" }}>
              모집 구간 <b>{kst(pv.windowFrom)}</b> ~ <b>{kst(pv.windowTo)}</b> (끝 시각 직전까지) ·
              1차 {kst(pv.startsAt)} · 2차 {kst(pv.followupAt)} · 안내 예정 {kst(pv.noticeDueAt)}
            </div>
            <div style={{ fontSize: 12.5 }}>
              대상 <b>{counts("eligible")}</b> · 중복 {counts("duplicate")} · 제외 {counts("excluded")} · 이월 {counts("deferred")}
            </div>
            {pv.unclassified > 0 && (
              <div className="note" style={{ color: "#c25400" }}>
                이 구간에 소스가 비어 있는 리드 유입 {pv.unclassified}건이 있습니다 — 세미나 신청인데 빠졌을 수 있으니 유입 연동을 확인하세요.
              </div>
            )}
            {pv.blockers.length > 0 && (
              <div className="note" style={{ color: "#c25400" }}>지금은 보내지 않습니다 — {pv.blockers.join(" · ")}</div>
            )}
            <div style={{ maxHeight: 340, overflow: "auto" }}>
              <table className="t" style={{ fontSize: 12 }}>
                <thead><tr><th>신청시각</th><th>브랜드</th><th>담당자</th><th>메일</th><th>문자</th><th>소스</th><th>구분</th><th>사유</th></tr></thead>
                <tbody>
                  {pv.targets.map((t) => (
                    <tr key={t.leadEventId}>
                      <td>{kst(t.appliedAt)}</td>
                      <td>{t.brandName || "—"}</td>
                      <td>{t.contactName || "—"}</td>
                      <td>{t.email ? "있음" : <span style={{ color: "#c92a2a" }}>없음</span>}</td>
                      <td>{t.phone ? "있음" : <span style={{ color: "#c92a2a" }}>없음</span>}</td>
                      <td>{t.sourceKey}</td>
                      <td>{TSTATUS_KO[t.status] ?? t.status}{t.late ? " · 늦은신청" : ""}</td>
                      <td style={{ color: "var(--ink3)" }}>{t.reason}</td>
                    </tr>
                  ))}
                  {pv.targets.length === 0 && <tr><td colSpan={8} style={{ color: "var(--ink3)" }}>이 구간에 새 세미나 신청이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 회차 · 발송 내역 ────────────────────────────────────────
function SessionsCard({ ov }: { ov: SeminarOverview }) {
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ targets: TargetRow[]; sends: SendRow[] } | null>(null);
  const a = useAction();

  const show = (id: string) => {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null);
    void a.run(async () => {
      const r = await seminarSessionDetailAction(id);
      if (r.ok && r.data) setDetail(r.data);
      return r;
    });
  };

  return (
    <div className="card" data-testid="seminar-sessions">
      <div className="hd"><b>📆 회차 · 발송 내역</b><span style={{ color: "var(--ink3)", fontSize: 11 }}>발송예정 · 완료 · 실패 · 제외 사유 · 메시지 id</span></div>
      <div className="bd" style={{ display: "grid", gap: 8 }}>
        {ov.sessions.length === 0 && <div className="note">아직 만든 회차가 없습니다 — 위에서 “대상 확정”을 누르면 생깁니다.</div>}
        {ov.sessions.map((s) => (
          <div key={s.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
              <b>{s.session_date}</b>
              <span style={{ color: "var(--ink3)", fontSize: 11.5 }}>
                1차 {kst(s.starts_at)} · 2차 {kst(s.followup_at)} · 모집 {kst(s.window_from)} ~ {kst(s.window_to)} ·
                {s.week_mode === "calendar_week" ? " 달력 주" : " 회차→회차"}
              </span>
              {!/^https?:\/\//i.test(s.zoom_url) && <span className="cellchip cc-no">Zoom 링크 없음</span>}
              <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => show(s.id)}>{open === s.id ? "접기" : "내역"}</button>
            </div>
            {open === s.id && (
              <div style={{ marginTop: 8 }}>
                {a.busy && <div style={{ fontSize: 12, color: "var(--ink3)" }}>불러오는 중…</div>}
                {a.msg && !a.msg.ok && <Msg m={a.msg} />}
                {detail && (
                  <div style={{ maxHeight: 360, overflow: "auto" }}>
                    <table className="t" style={{ fontSize: 12 }}>
                      <thead><tr><th>단계</th><th>채널</th><th>브랜드</th><th>상태</th><th>예정</th><th>발송</th><th>시도</th><th>메시지 id</th><th>사유</th></tr></thead>
                      <tbody>
                        {detail.sends.map((x) => (
                          <tr key={x.id}>
                            <td>{x.stage === "notice" ? "1차" : "2차"}</td>
                            <td>{x.channel === "email" ? "메일" : "문자"}</td>
                            <td>{x.brand_name || "—"}</td>
                            <td>{STATUS_KO[x.status] ?? x.status}</td>
                            <td>{kst(x.due_at)}</td>
                            <td>{kst(x.sent_at)}</td>
                            <td>{x.attempts}</td>
                            <td style={{ color: "var(--ink3)" }}>{x.provider_id ? `${x.provider}:${x.provider_id}` : "—"}</td>
                            <td style={{ color: x.error ? "#c92a2a" : "var(--ink3)" }}>{x.error || x.skip_reason || ""}</td>
                          </tr>
                        ))}
                        {detail.sends.length === 0 && <tr><td colSpan={9} style={{ color: "var(--ink3)" }}>발송 예약이 없습니다.</td></tr>}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink3)" }}>
                      대상 {detail.targets.filter((t) => t.status === "eligible").length} ·
                      중복 {detail.targets.filter((t) => t.status === "duplicate").length} ·
                      제외 {detail.targets.filter((t) => t.status === "excluded").length} ·
                      이월 {detail.targets.filter((t) => t.status === "deferred").length}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RunsCard({ ov }: { ov: SeminarOverview }) {
  return (
    <div className="card">
      <div className="hd"><b>🕘 실행 이력</b></div>
      <div className="bd">
        {ov.runs.length === 0 ? <div className="note">아직 실행 이력이 없습니다.</div> : (
          <table className="t" style={{ fontSize: 12 }}>
            <thead><tr><th>시작</th><th>종류</th><th>상태</th><th>요약</th><th>트리거</th></tr></thead>
            <tbody>
              {ov.runs.map((r) => (
                <tr key={r.id}>
                  <td>{kst(r.started_at)}</td>
                  <td>{r.kind === "dispatch" ? "발송" : "대상확정"}</td>
                  <td style={{ color: r.status === "error" ? "#c92a2a" : undefined }}>{r.status}</td>
                  <td style={{ color: "var(--ink3)" }}>{r.error || r.summary}</td>
                  <td style={{ color: "var(--ink3)" }}>{r.triggered_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── 공통 ────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 3 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}
function Msg({ m }: { m: { ok: boolean; text: string } }) {
  return <div style={{ marginTop: 6, fontSize: 12, whiteSpace: "pre-wrap", color: m.ok ? "#0b7a52" : "#c92a2a" }}>{m.text}</div>;
}
