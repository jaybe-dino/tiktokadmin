"use client";
// 세미나 모집 관리 화면. 행사·포스터·신청자·외부 공유를 한곳에서 다룬다.
//   순수 값은 lib/seminar-events-model 에서만 가져온다(DB 모듈을 끌고 오지 않도록).
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  sevOverviewAction, sevEventDetailAction, sevSaveEventAction, sevSetFlagsAction,
  sevClearPosterAction, sevSetRegStatusAction, sevSetRegNoteAction, sevSetRegOwnerAction,
  sevAddTestRegAction, sevClearTestAction,
  sevCreateShareAction, sevSetSharePasswordAction, sevSetShareFieldsAction,
  sevSetShareEnabledAction, sevSetShareExpiryAction, sevRotateShareAction,
  sevRevokeShareAction, sevRevokeShareSessionsAction,
  type SevOverview, type SevEventDetail,
} from "@/app/(dash)/seminar-events/actions";
import {
  EVENT_STATUSES, EVENT_STATUS_LABEL, EVENT_MODES, MODE_LABEL,
  REG_STATUSES, REG_STATUS_LABEL, SHARE_FIELDS, DEFAULT_SHARE_FIELDS,
  fmtWhen, fmtWhere, fmtKstDateTime, isoToKstLocal, kstLocalToIso,
  applyPath, eventPath, rosterPath, posterSrc, isEventStatus,
  POSTER_MAX_BYTES, SHARE_PW_MIN,
} from "@/lib/seminar-events-model";

type Res = { ok: boolean; error?: string; note?: string };
/** 액션마다 따로 pending 을 쥔다(버튼 하나가 전체를 잠그지 않게). */
function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, after?: (r: Res) => void) =>
    start(async () => {
      try { const r = await fn(); after?.(r); }
      finally { /* useTransition 은 예외에도 끝나야 한다 */ }
    });
  return { pending, run };
}

const ORIGIN = () => (typeof window === "undefined" ? "" : window.location.origin);

export default function SevAdminPanel() {
  const [ov, setOv] = useState<SevOverview | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState("");
  const [editing, setEditing] = useState<string | "new" | "">("");
  const load = useAction();

  const reload = useCallback(() => {
    load.run(async () => {
      const r = await sevOverviewAction();
      if (!r.ok || !r.data) { setErr(r.error ?? "불러오지 못했습니다."); return { ok: false }; }
      setErr(""); setOv(r.data); return { ok: true };
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload(); }, [reload]);

  const flash = (r: Res) => {
    if (!r.ok) { setErr(r.error ?? "실패했습니다."); return false; }
    setErr(""); setMsg(r.note ?? "반영했습니다."); reload(); return true;
  };

  if (!ov) {
    return <div className="card"><div className="bd">{err || "불러오는 중…"}</div></div>;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {!ov.schemaReady && (
        <div className="card"><div className="bd" style={{ color: "#c25400" }}>
          {ov.schemaError}<br />
          설정 &gt; 마이그레이션에서 <b>{ov.migration}</b> 만 단독 적용하면 이 화면이 동작합니다.
        </div></div>
      )}

      {(err || msg) && (
        <div className="card"><div className="bd" style={{ fontSize: 12.5, color: err ? "#c92a2a" : "#117a44" }}>
          {err || msg}
        </div></div>
      )}

      {/* ── 행사 목록 ── */}
      <div className="card">
        <div className="hd">
          <b>🎫 행사</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>
            공개 허브 <a href={ov.hubPath} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>{ov.hubPath}</a>
            {" · 게시(공개)와 접수(신청받기)는 따로 켭니다"}
          </span>
          {ov.canEdit && (
            <button className="btn sm pri" style={{ marginLeft: "auto" }}
              onClick={() => { setEditing(editing === "new" ? "" : "new"); }}>
              {editing === "new" ? "닫기" : "+ 행사 추가"}
            </button>
          )}
        </div>
        <div className="bd" style={{ display: "grid", gap: 10 }}>
          {editing === "new" && <EventEditor onDone={(r) => { if (flash(r)) setEditing(""); }} />}

          {ov.events.length === 0 && ov.schemaReady && (
            <div className="note">아직 등록된 행사가 없습니다 — 행사 추가로 시작하세요.</div>
          )}

          {ov.events.map((e) => {
            const status = isEventStatus(e.status) ? e.status : "draft";
            return (
              <div key={e.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className={`cellchip ${status === "open" ? "cc-ok" : status === "draft" ? "" : "cc-warn"}`}>
                    {EVENT_STATUS_LABEL[status]}
                  </span>
                  <b style={{ fontSize: 14 }}>{e.title}</b>
                  <span style={{ fontSize: 11, color: "var(--ink3)" }}>
                    {e.publish ? "공개" : "비공개(초안)"} · {e.apply_open ? "접수중" : "접수닫힘"}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button className="btn sm" onClick={() => setSel(sel === e.id ? "" : e.id)}>
                      {sel === e.id ? "신청자 닫기" : "신청자 보기"}
                    </button>
                    {ov.canEdit && (
                      <button className="btn sm" onClick={() => setEditing(editing === e.id ? "" : e.id)}>
                        {editing === e.id ? "수정 닫기" : "수정"}
                      </button>
                    )}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 5 }}>{fmtWhen(e)}</div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{fmtWhere(e)}</div>
                <div style={{ fontSize: 11.5, marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <a href={eventPath(e.slug)} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>상세 ↗</a>
                  <CopyLine label="고정 신청 URL" value={`${ORIGIN()}${applyPath(e.slug)}`} />
                  {e.capacity != null && <span style={{ color: "var(--ink3)" }}>정원 {e.capacity}명</span>}
                </div>

                {ov.canEdit && (
                  <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap", alignItems: "center" }}>
                    <select className="f" style={{ fontSize: 12 }} value={status}
                      onChange={(ev) => flashRun(() => sevSetFlagsAction(e.id, { status: ev.target.value }), flash)}>
                      {EVENT_STATUSES.map((s) => <option key={s} value={s}>{EVENT_STATUS_LABEL[s]}</option>)}
                    </select>
                    <button className="btn sm" onClick={() => flashRun(() => sevSetFlagsAction(e.id, { publish: !e.publish }), flash)}>
                      {e.publish ? "공개 내리기" : "공개하기"}
                    </button>
                    <button className="btn sm" onClick={() => flashRun(() => sevSetFlagsAction(e.id, { apply_open: !e.apply_open }), flash)}>
                      {e.apply_open ? "접수 닫기" : "접수 열기"}
                    </button>
                    <PosterBox eventId={e.id} fileId={e.poster_file_id}
                      onDone={(r) => flash(r)} />
                  </div>
                )}

                {editing === e.id && (
                  <div style={{ marginTop: 10 }}>
                    <EventEditor ev={e} onDone={(r) => { if (flash(r)) setEditing(""); }} />
                  </div>
                )}

                {sel === e.id && <EventDetail eventId={e.id} canEdit={ov.canEdit} canShare={ov.canShare} onFlash={flash} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 액션 하나를 돌리고 결과를 상단 메시지로 올린다. */
function flashRun(fn: () => Promise<Res>, flash: (r: Res) => boolean) {
  void fn().then(flash).catch(() => flash({ ok: false, error: "처리 중 오류가 발생했습니다." }));
}

// ── 행사 편집 ────────────────────────────────────────────────
type EventRow = SevOverview["events"][number];

function EventEditor({ ev, onDone }: { ev?: EventRow; onDone: (r: Res) => void }) {
  const a = useAction();
  const [v, setV] = useState({
    slug: ev?.slug ?? "", title: ev?.title ?? "", summary: ev?.summary ?? "",
    detail_md: ev?.detail_md ?? "", mode: ev?.mode ?? "online",
    venue: ev?.venue ?? "", address: ev?.address ?? "", venue_note: ev?.venue_note ?? "",
    hosts: ev?.hosts ?? "", recurring_note: ev?.recurring_note ?? "",
    startsAtLocal: isoToKstLocal(ev?.starts_at), endsAtLocal: isoToKstLocal(ev?.ends_at),
    time_tbd: Boolean(ev?.time_tbd), online_url: ev?.online_url ?? "",
    show_online_url: Boolean(ev?.show_online_url),
    capacity: ev?.capacity == null ? "" : String(ev.capacity),
    countries: ev?.countries ?? "", status: ev?.status ?? "draft",
    publish: Boolean(ev?.publish), apply_open: Boolean(ev?.apply_open),
  });
  const set = (k: keyof typeof v, val: unknown) => setV((p) => ({ ...p, [k]: val }));

  const save = () => a.run(
    () => sevSaveEventAction({
      id: ev?.id, slug: v.slug, title: v.title, summary: v.summary, detail_md: v.detail_md,
      mode: v.mode, venue: v.venue, address: v.address, venue_note: v.venue_note, hosts: v.hosts,
      startsAtLocal: v.startsAtLocal ? kstLocalToIso(v.startsAtLocal) : null,
      endsAtLocal: v.endsAtLocal ? kstLocalToIso(v.endsAtLocal) : null,
      time_tbd: v.time_tbd, recurring_note: v.recurring_note,
      online_url: v.online_url, show_online_url: v.show_online_url,
      capacity: v.capacity === "" ? null : Number(v.capacity),
      countries: v.countries, status: v.status, publish: v.publish, apply_open: v.apply_open,
    }),
    onDone);

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 12, background: "#fbfcfd" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 9 }}>
        <F label="제목" v={v.title} on={(x) => set("title", x)} />
        <F label="주소 조각(slug)" v={v.slug} on={(x) => set("slug", x)} hint="영문 소문자·숫자·하이픈. 공개 후에는 바꾸지 마세요." />
        <div>
          <L>진행 방식</L>
          <select className="f" value={v.mode} onChange={(e) => set("mode", e.target.value)}>
            {EVENT_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
        </div>
        <div>
          <L>모집 상태</L>
          <select className="f" value={v.status} onChange={(e) => set("status", e.target.value)}>
            {EVENT_STATUSES.map((s) => <option key={s} value={s}>{EVENT_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <F label="시작(KST)" v={v.startsAtLocal} on={(x) => set("startsAtLocal", x)} type="datetime-local" />
        <F label="종료(KST)" v={v.endsAtLocal} on={(x) => set("endsAtLocal", x)} type="datetime-local" />
        <F label="반복 안내" v={v.recurring_note} on={(x) => set("recurring_note", x)} hint="예: 매주 월요일 10:30 (KST)" />
        <F label="주최·주관" v={v.hosts} on={(x) => set("hosts", x)} />
        <F label="장소" v={v.venue} on={(x) => set("venue", x)} />
        <F label="주소" v={v.address} on={(x) => set("address", x)} />
        <F label="장소 비고" v={v.venue_note} on={(x) => set("venue_note", x)} hint="예: 제안 단계 · 대관 미확정" />
        <F label="정원(명)" v={v.capacity} on={(x) => set("capacity", x)} hint="비우면 미설정 — 정원 검사를 하지 않습니다." />
        <F label="관심 국가 선택지" v={v.countries} on={(x) => set("countries", x)} hint="쉼표 구분. 예: 일본,미국" />
        <F label="참가 링크" v={v.online_url} on={(x) => set("online_url", x)} hint="확정된 링크만 넣으세요." />
      </div>
      <div style={{ marginTop: 9 }}>
        <L>한 줄 소개</L>
        <input className="f" value={v.summary} onChange={(e) => set("summary", e.target.value)} />
      </div>
      <div style={{ marginTop: 9 }}>
        <L>상세 안내</L>
        <textarea className="f" style={{ height: 90 }} value={v.detail_md}
          onChange={(e) => set("detail_md", e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 12 }}>
        <label><input type="checkbox" checked={v.time_tbd} onChange={(e) => set("time_tbd", e.target.checked)} /> 시간 미정(날짜만 공개)</label>
        <label><input type="checkbox" checked={v.show_online_url} onChange={(e) => set("show_online_url", e.target.checked)} /> 참가 링크 공개</label>
        <label><input type="checkbox" checked={v.publish} onChange={(e) => set("publish", e.target.checked)} /> 공개 허브에 게시</label>
        <label><input type="checkbox" checked={v.apply_open} onChange={(e) => set("apply_open", e.target.checked)} /> 신청 접수</label>
      </div>
      <button className="btn sm pri" style={{ marginTop: 10 }} disabled={a.pending} onClick={save}>
        {a.pending ? "저장 중…" : ev ? "수정 저장" : "행사 만들기"}
      </button>
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 3 }}>{children}</label>;
}
function F({ label, v, on, hint, type }: { label: string; v: string; on: (x: string) => void; hint?: string; type?: string }) {
  return (
    <div>
      <L>{label}</L>
      <input className="f" type={type ?? "text"} value={v} onChange={(e) => on(e.target.value)} />
      {hint && <div style={{ fontSize: 10.5, color: "var(--ink3)", marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn sm" style={{ fontSize: 11 }} title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true); setTimeout(() => setCopied(false), 1500);
        }).catch(() => setCopied(false));
      }}>
      {copied ? "복사했습니다" : `${label} 복사`}
    </button>
  );
}

// ── 포스터 ───────────────────────────────────────────────────
function PosterBox({ eventId, fileId, onDone }: { eventId: string; fileId: string | null; onDone: (r: Res) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const a = useAction();

  const upload = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("eventId", eventId);
      fd.append("file", f);
      const res = await fetch("/api/events/poster-upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({ ok: false, error: "응답을 읽지 못했습니다." }));
      onDone(j.ok ? { ok: true, note: "포스터를 올렸습니다." } : { ok: false, error: j.error });
    } catch {
      onDone({ ok: false, error: "업로드 중 오류가 발생했습니다." });
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {fileId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterSrc(fileId)} alt="포스터 미리보기" style={{ height: 34, borderRadius: 5, border: "1px solid var(--line)" }} />
      )}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <button className="btn sm" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "올리는 중…" : fileId ? "포스터 교체" : "포스터 올리기"}
      </button>
      {fileId && (
        <button className="btn sm" disabled={a.pending} onClick={() => a.run(() => sevClearPosterAction(eventId), onDone)}>
          포스터 해제
        </button>
      )}
      <span style={{ fontSize: 10.5, color: "var(--ink3)" }}>
        PNG·JPG·WEBP {Math.round(POSTER_MAX_BYTES / (1024 * 1024))}MB 이하
      </span>
    </span>
  );
}

// ── 신청자 + 공유 ────────────────────────────────────────────
function EventDetail({ eventId, canEdit, canShare, onFlash }: {
  eventId: string; canEdit: boolean; canShare: boolean; onFlash: (r: Res) => boolean;
}) {
  const [d, setD] = useState<SevEventDetail | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [includeTest, setIncludeTest] = useState(false);
  const [err, setErr] = useState("");
  const a = useAction();

  const fetchDetail = useCallback(() => {
    a.run(async () => {
      const r = await sevEventDetailAction(eventId, { q, status, page, includeTest, pageSize: 25 });
      if (!r.ok || !r.data) { setErr(r.error ?? "불러오지 못했습니다."); return { ok: false }; }
      setErr(""); setD(r.data); return { ok: true };
    });
  }, [eventId, q, status, page, includeTest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const after = (r: Res) => { onFlash(r); fetchDetail(); };

  if (!d) return <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 10 }}>{err || "신청자 불러오는 중…"}</div>;

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12, display: "grid", gap: 12 }}>
      {/* 집계 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
        <b>접수 {d.counts.total}건</b>
        {REG_STATUSES.map((s) => (
          <span key={s} style={{ color: "var(--ink3)" }}>
            {REG_STATUS_LABEL[s]} {d.counts.byStatus[s] ?? 0}
          </span>
        ))}
        <span style={{ color: "var(--ink3)" }}>마케팅 동의 {d.counts.marketing}</span>
        <span style={{ color: "var(--ink3)" }}>
          정원 {d.event.capacity == null ? "미설정" : `${d.taken}/${d.event.capacity}`}
        </span>
      </div>

      {/* 검색·필터 */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
        <input className="f" style={{ minWidth: 180, fontSize: 12 }} placeholder="회사·브랜드·담당자·이메일·연락처"
          value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="f" style={{ fontSize: 12 }} value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">전체 상태</option>
          {REG_STATUSES.map((s) => <option key={s} value={s}>{REG_STATUS_LABEL[s]}</option>)}
        </select>
        <label><input type="checkbox" checked={includeTest}
          onChange={(e) => { setIncludeTest(e.target.checked); setPage(1); }} /> 검수용 TEST 포함</label>
        {canEdit && (
          <>
            <a className="btn sm" href={`/api/export/sev-roster?eventId=${eventId}${includeTest ? "&test=1" : ""}`}>CSV 내려받기</a>
            <button className="btn sm" disabled={a.pending} onClick={() => a.run(() => sevAddTestRegAction(eventId), after)}>
              검수용 1건 추가
            </button>
            <button className="btn sm" disabled={a.pending} onClick={() => a.run(() => sevClearTestAction(eventId), after)}>
              TEST 지우기
            </button>
          </>
        )}
      </div>

      {err && <div style={{ fontSize: 12, color: "#c92a2a" }}>{err}</div>}

      {d.regs.rows.length === 0 ? (
        <div className="note">조건에 맞는 신청이 없습니다.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="t" style={{ fontSize: 12, minWidth: 720 }}>
            <thead><tr>
              <th>신청일시</th><th>회사 · 브랜드</th><th>담당자</th><th>연락처</th>
              <th>동의</th><th>상태</th><th>담당</th><th>내부 메모</th>
            </tr></thead>
            <tbody>
              {d.regs.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtKstDateTime(r.created_at)}</td>
                  <td>
                    <b>{r.company_name}</b>{r.is_test && <span className="chip red" style={{ marginLeft: 5, fontSize: 10 }}>TEST</span>}
                    {r.brand_name && <div style={{ color: "var(--ink3)" }}>{r.brand_name}</div>}
                    {r.site_url && <a href={r.site_url} target="_blank" rel="noreferrer" style={{ color: "var(--acc)", fontSize: 11 }}>사이트 ↗</a>}
                  </td>
                  <td>{r.contact_name}<div style={{ color: "var(--ink3)" }}>{r.contact_title}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a href={`tel:${r.phone}`} style={{ color: "var(--acc)" }}>{r.phone}</a>
                    <div><a href={`mailto:${r.email}`} style={{ color: "var(--acc)" }}>{r.email}</a></div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div>{r.privacy_agreed ? "필수 ✔" : "필수 ✖"}</div>
                    <div style={{ color: "var(--ink3)" }}>{r.marketing_agreed ? "마케팅 ✔" : "마케팅 —"}</div>
                  </td>
                  <td>
                    <select className="f" style={{ fontSize: 11 }} value={r.status}
                      onChange={(e) => a.run(() => sevSetRegStatusAction(r.id, e.target.value), after)}>
                      {REG_STATUSES.map((s) => <option key={s} value={s}>{REG_STATUS_LABEL[s]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="f" style={{ fontSize: 11 }} value={r.owner_admin_id ?? ""}
                      onChange={(e) => a.run(() => sevSetRegOwnerAction(r.id, e.target.value), after)}>
                      <option value="">미지정</option>
                      {d.admins.map((ad) => <option key={ad.id} value={ad.id}>{ad.name}</option>)}
                    </select>
                  </td>
                  <td><MemoCell id={r.id} value={r.admin_note} onDone={after} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      {d.regs.pages > 1 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>이전</button>
          <span>{d.regs.page} / {d.regs.pages} 페이지 · 총 {d.regs.total}건</span>
          <button className="btn sm" disabled={page >= d.regs.pages} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}

      {canShare && <SharePanel eventId={eventId} shares={d.shares} onDone={after} />}
      {!canShare && (
        <div className="note" style={{ fontSize: 11.5 }}>
          외부 열람 링크 설정은 대표 계정에서만 보입니다.
        </div>
      )}
    </div>
  );
}

function MemoCell({ id, value, onDone }: { id: string; value: string; onDone: (r: Res) => void }) {
  const [v, setV] = useState(value);
  const a = useAction();
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <input className="f" style={{ fontSize: 11, minWidth: 120 }} value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn sm" disabled={a.pending || v === value}
        onClick={() => a.run(() => sevSetRegNoteAction(id, v), onDone)}>저장</button>
    </span>
  );
}

// ── 외부 공유 설정 ───────────────────────────────────────────
function SharePanel({ eventId, shares, onDone }: {
  eventId: string; shares: SevEventDetail["shares"]; onDone: (r: Res) => void;
}) {
  const a = useAction();
  const [label, setLabel] = useState("");
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>🔐 외부 열람 링크</b>
        <span style={{ fontSize: 11, color: "var(--ink3)" }}>
          행사별 전용 URL + 비밀번호 · 읽기 전용 · 기본 OFF
        </span>
      </div>
      <div className="note" style={{ fontSize: 11.5, marginTop: 8 }}>
        공유 대상과 노출 항목을 확인한 뒤에만 켜세요. 비밀번호를 설정하지 않으면 링크는 열리지 않습니다.
        연락처는 마스킹된 값만 선택할 수 있고, 내부 메모·담당자는 어떤 설정으로도 나가지 않습니다.
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
        <input className="f" style={{ fontSize: 12, minWidth: 160 }} placeholder="공유 대상 메모(예: 숭실대 캠퍼스타운)"
          value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn sm pri" disabled={a.pending}
          onClick={() => a.run(() => sevCreateShareAction(eventId, label), (r) => { onDone(r); setLabel(""); })}>
          링크 발급
        </button>
      </div>

      {shares.length === 0 && <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 8 }}>발급된 링크가 없습니다.</div>}
      {shares.map((s) => <ShareRow key={s.id} s={s} onDone={onDone} />)}
    </div>
  );
}

function ShareRow({ s, onDone }: { s: SevEventDetail["shares"][number]; onDone: (r: Res) => void }) {
  const a = useAction();
  const [pw, setPw] = useState("");
  const [fields, setFields] = useState<string[]>(s.fields?.length ? s.fields : [...DEFAULT_SHARE_FIELDS]);
  const [dl, setDl] = useState(Boolean(s.allow_download));
  const [exp, setExp] = useState(isoToKstLocal(s.expires_at));

  const toggle = (k: string) => setFields((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const url = `${ORIGIN()}${rosterPath(s.token)}`;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: 10, marginTop: 9, background: s.live ? "#f7fbf8" : "#fbfcfd" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
        <span className={`cellchip ${s.live ? "cc-ok" : "cc-no"}`}>{s.live ? "열람 가능" : "닫힘"}</span>
        <b>{s.label || "(대상 미기재)"}</b>
        <span style={{ color: "var(--ink3)" }}>
          {s.has_password ? "비밀번호 설정됨" : "비밀번호 없음"}
          {s.revoked_at ? " · 철회됨" : ""}
          {s.expires_at ? ` · 만료 ${fmtKstDateTime(s.expires_at)}` : ""}
          {` · 활성 세션 ${s.active_sessions}`}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <CopyLine label="열람 URL" value={url} />
        </span>
      </div>

      {/* 노출 항목 */}
      <div style={{ marginTop: 9 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 4 }}>외부에 보여줄 항목</div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", fontSize: 11.5 }}>
          {SHARE_FIELDS.map((f) => (
            <label key={f.key}>
              <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} /> {f.label}
            </label>
          ))}
        </div>
        <label style={{ display: "block", fontSize: 11.5, marginTop: 7 }}>
          <input type="checkbox" checked={dl} onChange={(e) => setDl(e.target.checked)} /> 외부 CSV 내려받기 허용(기본 꺼짐)
        </label>
        <button className="btn sm" style={{ marginTop: 7 }} disabled={a.pending}
          onClick={() => a.run(() => sevSetShareFieldsAction(s.id, fields, dl), onDone)}>
          노출 항목 저장
        </button>
      </div>

      {/* 비밀번호·만료·회전 */}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input className="f" type="password" autoComplete="new-password" style={{ fontSize: 12, minWidth: 150 }}
          placeholder={`열람 비밀번호(${SHARE_PW_MIN}자 이상)`} value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn sm" disabled={a.pending || !pw}
          onClick={() => a.run(() => sevSetSharePasswordAction(s.id, pw), (r) => { onDone(r); setPw(""); })}>
          비밀번호 설정
        </button>
        <input className="f" type="datetime-local" style={{ fontSize: 12 }} value={exp}
          onChange={(e) => setExp(e.target.value)} />
        <button className="btn sm" disabled={a.pending}
          onClick={() => a.run(() => sevSetShareExpiryAction(s.id, exp ? kstLocalToIso(exp) : null), onDone)}>
          만료 저장
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
        <button className="btn sm pri" disabled={a.pending || !s.has_password || Boolean(s.revoked_at)}
          onClick={() => a.run(() => sevSetShareEnabledAction(s.id, !s.enabled), onDone)}>
          {s.enabled ? "외부 열람 끄기" : "외부 열람 켜기"}
        </button>
        <button className="btn sm" disabled={a.pending} onClick={() => a.run(() => sevRevokeShareSessionsAction(s.id), onDone)}>
          열람 세션 모두 끊기
        </button>
        <button className="btn sm" disabled={a.pending} onClick={() => a.run(() => sevRotateShareAction(s.id), onDone)}>
          주소 새로 발급(회전)
        </button>
        <button className="btn sm" style={{ color: "#e03131" }} disabled={a.pending || Boolean(s.revoked_at)}
          onClick={() => a.run(() => sevRevokeShareAction(s.id), onDone)}>
          링크 철회
        </button>
      </div>
    </div>
  );
}
