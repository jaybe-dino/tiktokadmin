"use client";
// 세미나 신청 관리 — 회차별 집계·검색·선정/대기/취소·CSV·안내문 초안.
//   선정은 한 건씩 사람이 누른다. 선착순 자동선정·자동마감은 없다.
//   접속 링크는 대표만 다루고 공개 화면·CSV 에는 나가지 않는다.
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  sapOverviewAction, sapListAction, sapSetStatusAction, sapSetNoteAction, sapWithdrawAdsAction,
  sapSetZoomAction, sapSetActiveAction, sapSetCapAction, sapCsvAction, sapEventsAction,
  sapCandidatesAction, sapLinkBrandAction, sapAddTestAction, sapDeleteTestAction, sapDraftAction,
  type SapOverview,
} from "@/app/(dash)/seminar-apply-admin/actions";
import type { RegList, RegRow, RegEventRow } from "@/lib/seminar-apply";
import type { MatchCandidate } from "@/lib/seminar-apply";
import {
  STATUS_KO, STATUSES, fmtSessionWhen, fmtSessionShort, maskEmail, maskPhone,
  REVENUE_BANDS, OVERSEAS_REVENUE_BANDS, APPLY_PATH,
} from "@/lib/seminar-apply-model";

const band = (k: string, l: { key: string; label: string }[]) => k ? (l.find((b) => b.key === k)?.label ?? k) : "—";

export default function SeminarApplyAdminPanel() {
  const [pending, start] = useTransition();
  const [ov, setOv] = useState<SapOverview | null>(null);
  const [list, setList] = useState<RegList | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [sessionNo, setSessionNo] = useState<number | "">("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [consult, setConsult] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const filters = useCallback(() => ({
    sessionNo: sessionNo === "" ? undefined : Number(sessionNo),
    status: status || undefined, q: q.trim() || undefined,
    consult: consult || undefined,
  }), [sessionNo, status, q, consult]);

  const loadAll = useCallback((p = 1) => start(async () => {
    setErr("");
    const [o, l] = await Promise.all([sapOverviewAction(), sapListAction({ ...filters(), page: p })]);
    if (!o.ok || !o.data) { setErr(o.error ?? "불러오지 못했습니다."); return; }
    setOv(o.data);
    if (!l.ok || !l.data) { setErr(l.error ?? "목록을 불러오지 못했습니다."); return; }
    setList(l.data); setPage(p);
  }), [filters]);

  useEffect(() => { loadAll(1); }, [loadAll]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; note?: string }>) => start(async () => {
    setErr(""); setMsg("");
    const r = await fn();
    if (!r.ok) { setErr(r.error ?? "실패했습니다."); return; }
    if (r.note) setMsg(r.note);
    const [o, l] = await Promise.all([sapOverviewAction(), sapListAction({ ...filters(), page })]);
    if (o.ok && o.data) setOv(o.data);
    if (l.ok && l.data) setList(l.data);
  });

  const csv = () => start(async () => {
    setErr(""); setMsg("");
    const r = await sapCsvAction(filters());
    if (!r.ok || !r.csv) { setErr(r.error ?? "내려받기 실패"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
    a.download = r.filename ?? "세미나신청.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(r.masked
      ? "내려받았습니다 — 연락처 조회 권한이 없어 이메일·연락처는 가려서 담았습니다. 접속 링크는 담지 않습니다."
      : "내려받았습니다 — 접속 링크는 담지 않습니다.");
  });

  if (!ov) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="bd" style={{ fontSize: 12.5 }}>
          {err ? <span style={{ color: "#c92a2a" }}>{err}</span> : pending ? "불러오는 중…" : "—"}
          {err && <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => loadAll(1)}>다시 시도</button>}
        </div>
      </div>
    );
  }

  if (!ov.schemaReady) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="hd"><b>⛔ 표가 아직 없습니다</b></div>
        <div className="bd" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
          {ov.schemaError}
          <div style={{ marginTop: 6, color: "var(--ink3)" }}>
            설정 화면에서 <b>{ov.migration}</b> 를 적용한 뒤 다시 열어주세요.
          </div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => loadAll(1)}>다시 확인</button>
        </div>
      </div>
    );
  }

  const cfg = ov.config;

  return (
    <>
      {/* ── 발송 상태 ── */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="hd">
          <b>📋 모집 현황</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>
            공개 신청 주소: <a href={APPLY_PATH} target="_blank" rel="noreferrer" style={{ color: "var(--acc)" }}>{APPLY_PATH}</a>
          </span>
        </div>
        <div className="bd" style={{ display: "grid", gap: 10 }}>
          <div className="note" style={{ fontSize: 11.5, lineHeight: 1.8 }}>
            같은 내용의 세미나를 <b>4회</b> 운영하고 신청자는 1개 회차를 고릅니다.
            <b>신청 접수는 인원 제한 없이</b> 받고, <b>30명 상한은 선정에만</b> 적용합니다 —
            접수는 자리를 차지하지 않습니다.
            <div style={{ marginTop: 4 }}>
              선정 안내·접속 링크 발송: <b style={{ color: cfg?.send_enabled ? "#c92a2a" : "#117a44" }}>
                {cfg?.send_enabled ? "ON" : "OFF"}</b> ·
              자동 접수메일: <b style={{ color: cfg?.auto_ack_enabled ? "#c92a2a" : "#117a44" }}>
                {cfg?.auto_ack_enabled ? "ON" : "OFF"}</b>
              {" "}— OFF 인 동안 이 화면은 <b>초안만 만들고 아무것도 보내지 않습니다</b>.
            </div>
            {ov.expiry && (
              <div style={{ marginTop: 4, color: "var(--ink3)" }}>
                보유기간 경과: 필수정보 {ov.expiry.requiredDue}건 · 광고동의 {ov.expiry.adsDue}건
                {" "}(세어서 보여주기만 합니다 — 자동 삭제하지 않습니다)
              </div>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="t" style={{ fontSize: 12, minWidth: 760 }}>
              <thead><tr>
                <th>회차</th><th>일시</th><th>접수</th><th>선정</th><th>대기</th><th>미선정</th><th>취소</th>
                <th>선정상한</th><th>접수</th><th>접속 링크</th>
              </tr></thead>
              <tbody>
                {ov.sessions.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.session_no}회차</b></td>
                    <td>{fmtSessionShort(s.starts_at)} 11:00</td>
                    <td>{s.submitted}</td>
                    <td><b style={{ color: s.selected >= s.select_cap ? "#c25400" : "#117a44" }}>{s.selected}</b></td>
                    <td>{s.waitlisted}</td>
                    <td>{s.not_selected}</td>
                    <td>{s.cancelled}</td>
                    <td>
                      {ov.canEdit ? (
                        <CapInput value={s.select_cap} disabled={pending}
                          onSave={(n) => act(() => sapSetCapAction(s.id, n))} />
                      ) : s.select_cap}
                    </td>
                    <td>
                      {ov.canEdit ? (
                        <button className="btn sm" disabled={pending}
                          onClick={() => act(() => sapSetActiveAction(s.id, !s.active))}>
                          {s.active ? "받는 중" : "닫힘"}
                        </button>
                      ) : (s.active ? "받는 중" : "닫힘")}
                    </td>
                    <td>
                      {ov.canZoom ? (
                        <ZoomInput url={s.zoom_url} note={s.zoom_note} disabled={pending}
                          onSave={(u, n) => act(() => sapSetZoomAction(s.id, u, n))} />
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--ink3)" }}>
                          {s.zoom_url ? "설정됨(대표만 열람)" : "미설정"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── 신청자 ── */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="hd">
          <b>👥 신청자</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>전체 {list?.total ?? 0}건</span>
        </div>
        <div className="bd" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select className="f" value={sessionNo} style={{ fontSize: 12, width: 110 }}
              onChange={(e) => { const v = e.target.value; setSessionNo(v === "" ? "" : Number(v)); }}>
              <option value="">회차 전체</option>
              {ov.sessions.map((s) => <option key={s.id} value={s.session_no}>{s.session_no}회차</option>)}
            </select>
            <select className="f" value={status} style={{ fontSize: 12, width: 110 }}
              onChange={(e) => setStatus(e.target.value)}>
              <option value="">상태 전체</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_KO[s]}</option>)}
            </select>
            <input className="f" placeholder="회사·브랜드·담당자 / 이메일 전체" value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") loadAll(1); }}
              style={{ fontSize: 12, width: 230 }} />
            <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={consult} onChange={(e) => setConsult(e.target.checked)} />
              1:1 상담 희망만
            </label>
            <button className="btn sm" disabled={pending} onClick={() => loadAll(1)}>찾기</button>
            <button className="btn sm" disabled={pending} onClick={csv}>CSV</button>
            {ov.canEdit && (
              <>
                <button className="btn sm" disabled={pending}
                  onClick={() => act(() => sapAddTestAction(Number(sessionNo) || 1))}>검수용 합성 1건</button>
                <button className="btn sm" disabled={pending} style={{ color: "#c25400" }}
                  onClick={() => { if (confirm("합성(TEST) 신청만 지웁니다. 실제 신청은 그대로입니다.\n진행할까요?")) act(sapDeleteTestAction); }}>
                  합성 지우기
                </button>
              </>
            )}
          </div>

          {err && <div style={{ fontSize: 12.5, color: "#c92a2a" }}>{err}</div>}
          {msg && <div style={{ fontSize: 12.5, color: "#117a44" }}>{msg}</div>}

          <div style={{ overflowX: "auto" }}>
            <table className="t" style={{ fontSize: 12, minWidth: 900 }}>
              <thead><tr>
                <th>회차</th><th>상태</th><th>회사·브랜드</th><th>담당자</th><th>직무</th>
                <th>이메일</th><th>단계</th><th>희망국가</th><th>상담</th><th>광고</th><th>접수</th><th></th>
              </tr></thead>
              <tbody>
                {(list?.rows ?? []).map((r) => (
                  <RegRowView key={r.id} r={r} canEdit={ov.canEdit} pending={pending}
                    open={open === r.id} onOpen={() => setOpen(open === r.id ? null : r.id)}
                    act={act} />
                ))}
                {list && list.rows.length === 0 && (
                  <tr><td colSpan={12} style={{ color: "var(--ink3)" }}>조건에 맞는 신청이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {list && list.pages > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <button className="btn sm" disabled={pending || list.page <= 1} onClick={() => loadAll(list.page - 1)}>이전</button>
              <span>{list.page} / {list.pages}</span>
              <button className="btn sm" disabled={pending || list.page >= list.pages} onClick={() => loadAll(list.page + 1)}>다음</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── 신청 1건 ─────────────────────────────────────────────────
function RegRowView({ r, canEdit, pending, open, onOpen, act }: {
  r: RegRow; canEdit: boolean; pending: boolean; open: boolean; onOpen: () => void;
  act: (fn: () => Promise<{ ok: boolean; error?: string; note?: string }>) => void;
}) {
  const [events, setEvents] = useState<RegEventRow[] | null>(null);
  const [cands, setCands] = useState<MatchCandidate[] | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [note, setNote] = useState(r.admin_note);

  useEffect(() => {
    if (!open) return;
    sapEventsAction(r.id).then((x) => { if (x.ok) setEvents(x.rows ?? []); });
    sapCandidatesAction(r.id).then((x) => { if (x.ok) setCands(x.rows ?? []); });
  }, [open, r.id]);

  const pick = (next: string) => {
    const reason = prompt(`상태를 "${STATUS_KO[next as keyof typeof STATUS_KO] ?? next}"로 바꿉니다.\n사유를 적어 주세요(이력에 남습니다).`);
    if (reason === null) return;
    act(() => sapSetStatusAction(r.id, next, reason));
  };

  return (
    <>
      <tr>
        <td>{r.session_no}회차</td>
        <td><StatusChip s={r.status} /></td>
        <td>
          <b>{r.company_name}</b>
          <div style={{ color: "var(--ink3)" }}>{r.no_brand ? "(브랜드 미보유)" : r.brand_name}</div>
        </td>
        <td>{r.contact_name}</td>
        <td>{r.job_role === "기타" && r.job_role_etc ? `기타(${r.job_role_etc})` : r.job_role}</td>
        <td>{maskEmail(r.email)}</td>
        <td style={{ maxWidth: 150 }}>{r.overseas_stage}</td>
        <td style={{ maxWidth: 140 }}>{r.target_countries}</td>
        <td>{r.wants_consult ? "희망" : "—"}</td>
        <td>{r.consent_ads ? "동의" : "—"}</td>
        <td>{r.created_at.slice(5, 16)}{r.is_test && <b style={{ color: "#c25400" }}> TEST</b>}</td>
        <td><button className="btn sm" onClick={onOpen}>{open ? "닫기" : "열기"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={12} style={{ background: "#f8fafc" }}>
            <div style={{ display: "grid", gap: 10, padding: "4px 0 8px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, fontSize: 12 }}>
                <KV k="업무 이메일">{maskEmail(r.email)}</KV>
                <KV k="연락처">{r.phone ? maskPhone(r.phone) : "—"}</KV>
                <KV k="공식 URL">{r.site_url || "—"}</KV>
                <KV k="상품 카테고리">{r.product_category}</KV>
                <KV k="판매 국가">{r.selling_countries || "—"}</KV>
                <KV k="판매 채널">{r.selling_channels || "—"}</KV>
                <KV k="매출 구간">{band(r.revenue_band, REVENUE_BANDS)}</KV>
                <KV k="해외 매출 구간">{band(r.overseas_revenue_band, OVERSEAS_REVENUE_BANDS)}</KV>
                <KV k="수출 예정">{r.export_timing || "—"}</KV>
                <KV k="희망 지원">{r.support_areas || "—"}</KV>
                <KV k="사업자번호">{r.biz_no || "—"}</KV>
                <KV k="출처">{[r.source, r.utm_source, r.utm_campaign, r.campaign_id].filter(Boolean).join(" · ") || "—"}</KV>
                <KV k="선택정보 동의">{r.consent_optional ? "동의" : "미동의"}</KV>
                <KV k="광고 동의">
                  {r.consent_ads ? "동의" : "미동의"}
                  {r.consent_ads_withdrawn_at && " (철회됨)"}
                  {r.consent_ads && canEdit && (
                    <button className="btn sm" style={{ marginLeft: 6 }} disabled={pending}
                      onClick={() => { if (confirm("이 신청의 광고 수신 동의를 철회 처리합니다.\n기존 수신거부 명단은 건드리지 않습니다.")) act(() => sapWithdrawAdsAction(r.id)); }}>
                      철회
                    </button>
                  )}
                </KV>
                <KV k="동의 버전">{r.consent_version || "—"}</KV>
                <KV k="필수정보 만료">{(r.consent_required_expires_at ?? "").slice(0, 10) || "—"}</KV>
                <KV k="광고동의 만료">{(r.consent_ads_expires_at ?? "").slice(0, 10) || "—"}</KV>
                <KV k="회차 일시">{fmtSessionWhen(r.session_starts_at)}</KV>
              </div>

              <div style={{ fontSize: 12 }}>
                <b>질문·해결과제</b>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 4, background: "#fff", border: "1px solid var(--line)",
                  borderRadius: 8, padding: "8px 10px", lineHeight: 1.7 }}>{r.question}</div>
              </div>

              {canEdit && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>상태:</span>
                  {STATUSES.filter((s) => s !== r.status).map((s) => (
                    <button key={s} className="btn sm" disabled={pending} onClick={() => pick(s)}>{STATUS_KO[s]}</button>
                  ))}
                  <button className="btn sm" disabled={pending}
                    onClick={() => sapDraftAction(r.id, "selected").then((x) => { if (x.ok) setDraft({ subject: x.subject!, body: x.body! }); })}>
                    선정 안내 초안
                  </button>
                  <button className="btn sm" disabled={pending}
                    onClick={() => sapDraftAction(r.id, "zoom").then((x) => { if (x.ok) setDraft({ subject: x.subject!, body: x.body! }); })}>
                    접속 안내 초안
                  </button>
                </div>
              )}

              {draft && (
                <div style={{ fontSize: 12 }}>
                  <b>초안 — 보내지 않았습니다</b>
                  <div style={{ marginTop: 4, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontWeight: 700 }}>{draft.subject}</div>
                    <div style={{ whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.7 }}>{draft.body}</div>
                  </div>
                </div>
              )}

              {canEdit && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input className="f" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="관리 메모" style={{ fontSize: 12, width: 320 }} />
                  <button className="btn sm" disabled={pending} onClick={() => act(() => sapSetNoteAction(r.id, note))}>메모 저장</button>
                </div>
              )}

              {cands && cands.length > 0 && (
                <div style={{ fontSize: 12 }}>
                  <b>기존 고객 원장 후보</b>
                  <span style={{ color: "var(--ink3)", marginLeft: 6 }}>
                    확인한 뒤에만 연결하세요 — 원장 값은 바뀌지 않습니다.
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    {cands.map((c) => (
                      <span key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "4px 8px", background: "#fff" }}>
                        {c.brand_name} <span style={{ color: "var(--ink3)" }}>({c.why})</span>
                        {canEdit && r.brand_id !== c.id && (
                          <button className="btn sm" style={{ marginLeft: 6 }} disabled={pending}
                            onClick={() => act(() => sapLinkBrandAction(r.id, c.id))}>연결</button>
                        )}
                        {r.brand_id === c.id && <b style={{ marginLeft: 6, color: "#117a44" }}>연결됨</b>}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {events && (
                <div style={{ fontSize: 11.5 }}>
                  <b>변경 이력</b>
                  <div style={{ marginTop: 4 }}>
                    {events.length === 0 ? <span style={{ color: "var(--ink3)" }}>없습니다.</span> : events.map((e) => (
                      <div key={e.id} style={{ color: "var(--ink3)" }}>
                        {e.at.slice(0, 16)} · {e.field} {e.old_value && `${e.old_value} → `}{e.new_value}
                        {e.reason && ` · ${e.reason}`} · {e.actor}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: "var(--ink3)", fontSize: 11 }}>{k}</div>
      <div>{children}</div>
    </div>
  );
}
function StatusChip({ s }: { s: keyof typeof STATUS_KO }) {
  const color: Record<string, string> = {
    submitted: "#3d4756", selected: "#117a44", waitlisted: "#c25400",
    not_selected: "#6b7684", cancelled: "#c92a2a",
  };
  return <b style={{ color: color[s] ?? "#3d4756" }}>{STATUS_KO[s] ?? s}</b>;
}
function CapInput({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <input className="f" value={v} onChange={(e) => setV(e.target.value)} style={{ fontSize: 11, width: 52 }} />
      {v !== String(value) && (
        <button className="btn sm" disabled={disabled} onClick={() => onSave(Number(v))}>저장</button>
      )}
    </span>
  );
}
function ZoomInput({ url, note, disabled, onSave }: {
  url: string; note: string; disabled: boolean; onSave: (u: string, n: string) => void;
}) {
  const [u, setU] = useState(url);
  const [n, setN] = useState(note);
  const [show, setShow] = useState(false);
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {!show ? (
        <>
          <span style={{ fontSize: 11, color: url ? "#117a44" : "var(--ink3)" }}>{url ? "설정됨" : "미설정"}</span>
          <button className="btn sm" onClick={() => setShow(true)}>입력</button>
        </>
      ) : (
        <>
          <input className="f" value={u} onChange={(e) => setU(e.target.value)}
            placeholder="https://… (비공개 저장)" style={{ fontSize: 11, width: 190 }} />
          <input className="f" value={n} onChange={(e) => setN(e.target.value)}
            placeholder="메모" style={{ fontSize: 11, width: 90 }} />
          <button className="btn sm pri" disabled={disabled} onClick={() => { onSave(u, n); setShow(false); }}>저장</button>
          <button className="btn sm" onClick={() => { setU(url); setN(note); setShow(false); }}>취소</button>
        </>
      )}
    </span>
  );
}
