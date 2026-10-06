"use client";
// 발송제외(수신거부) 명단 — 최종 체크 화면.
//   세미나 1~4회차 안내·광고를 포함해 모든 자동 발송이 보내기 직전에 이 명단을 본다.
//   화면에는 마스킹한 주소만 나온다. 검색은 전체 주소를 정확히 넣어야 찾아진다.
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  optOutOverviewAction, addOptOutAction, addOptOutsBulkAction, removeOptOutAction,
} from "@/app/(dash)/optouts/actions";
import type { OptOutOverview } from "@/app/(dash)/optouts/actions";

const SOURCE_KO: Record<string, string> = {
  link: "고객이 직접(링크)",
  admin: "담당자 수동 등록",
  import: "일괄 반입",
  qa: "검증용",
};
const KIND_KO: Record<string, string> = { email: "이메일", phone: "문자" };

export default function OptOutListPanel() {
  const [pending, start] = useTransition();
  const [data, setData] = useState<OptOutOverview | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);

  const [addVal, setAddVal] = useState("");
  const [addReason, setAddReason] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback((opts: { q?: string; kind?: string; page?: number }) => start(async () => {
    setErr("");
    const r = await optOutOverviewAction(opts);
    if (!r.ok || !r.data) { setErr(r.error ?? "조회 실패"); setData(null); return; }
    setData(r.data);
  }), []);

  useEffect(() => { load({ page: 1 }); }, [load]);

  const refresh = () => load({ q, kind, page });

  const search = () => { setPage(1); load({ q, kind, page: 1 }); };

  const goPage = (p: number) => { setPage(p); load({ q, kind, page: p }); };

  const addOne = () => start(async () => {
    setErr(""); setMsg("");
    const r = await addOptOutAction(addVal, addReason);
    if (!r.ok) { setErr(r.error ?? "등록 실패"); return; }
    setMsg(r.note ?? "등록했습니다.");
    setAddVal("");
    load({ q, kind, page });
  });

  const addBulk = () => start(async () => {
    setErr(""); setMsg("");
    const r = await addOptOutsBulkAction(bulk, addReason);
    if (r.error) { setErr(r.error); return; }
    setMsg(r.note);
    if (r.failed.length) {
      setErr(`확인 필요 — ${r.failed.map((f) => `${f.input}: ${f.error}`).join(" / ").slice(0, 400)}`);
    }
    if (r.added || r.already) setBulk("");
    load({ q, kind, page });
  });

  const remove = (id: string, masked: string) => start(async () => {
    setErr(""); setMsg("");
    const reason = prompt(`${masked} 를 발송제외 명단에서 뺍니다.\n왜 빼는지 적어주세요(이력에 남습니다).`);
    if (reason === null) return;
    const r = await removeOptOutAction(id, reason);
    if (!r.ok) { setErr(r.error ?? "해제 실패"); return; }
    setMsg(r.note ?? "해제했습니다.");
    load({ q, kind, page });
  });

  const csv = () => {
    if (!data) return;
    const head = ["수단", "주소(마스킹)", "등록 경로", "브랜드", "메모", "최초 등록", "최근 확인", "확인 횟수"];
    const lines = [head.join(",")].concat(data.list.rows.map((r) => [
      KIND_KO[r.kind] ?? r.kind, r.addr_masked, SOURCE_KO[r.source] ?? r.source,
      r.brand_name ?? "", r.note, r.opted_out_at.slice(0, 19), r.last_confirm_at.slice(0, 19),
      String(r.confirm_count),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `발송제외_명단_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!data) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="bd" style={{ fontSize: 12.5 }}>
          {err ? <span style={{ color: "#c92a2a" }}>{err}</span> : pending ? "불러오는 중…" : "—"}
          {err && <button className="btn sm" style={{ marginLeft: 8 }} onClick={refresh}>다시 시도</button>}
        </div>
      </div>
    );
  }

  if (!data.schemaReady) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="hd"><b>⛔ 명단 표가 아직 없습니다</b></div>
        <div className="bd" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
          {data.schemaError}
          <div style={{ marginTop: 6, color: "var(--ink3)" }}>
            설정 화면에서 <b>{data.migration}</b> 를 적용한 뒤 다시 열어주세요.
            표가 없는 동안은 <b>명단이 비었다고 보지 않습니다</b> — 광고 발송은 확인 실패로 막힙니다.
          </div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={refresh}>다시 확인</button>
        </div>
      </div>
    );
  }

  const { counts, list, events } = data;

  return (
    <>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="hd">
          <b>🚫 발송제외(수신거부) 명단</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>
            전체 {counts.total}건 · 이메일 {counts.email} · 문자 {counts.phone}
          </span>
        </div>
        <div className="bd" style={{ display: "grid", gap: 10 }}>
          <div className="note" style={{ fontSize: 11.5, lineHeight: 1.8 }}>
            세미나 <b>1~4회차 안내</b>와 광고성 2차 안내, 유입 즉시 자동 안내가 모두 보내기 직전에 이 명단을 봅니다.
            명단에 있으면 보내지 않고 발송 내역에 <b>제외 사유</b>가 남아 담당자가 개별로 연락할 수 있습니다.
            명단 조회가 실패하면 빈 명단으로 보지 않고 발송을 막습니다.
            <div style={{ marginTop: 4, color: "var(--ink3)" }}>
              브랜드 단위 <b>전체 수신거부</b>(brands.msg_opt_out)는 그대로 살아 있고, 둘 중 하나라도 켜져 있으면 나가지 않습니다.
              화면에는 가린 주소만 보입니다 — 찾을 때는 전체 주소를 그대로 넣어주세요(부분 검색은 되지 않습니다).
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input className="f" placeholder="이메일 또는 휴대폰 전체" value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              style={{ fontSize: 12, width: 240 }} />
            <select className="f" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); load({ q, kind: e.target.value, page: 1 }); }}
              style={{ fontSize: 12, width: 130 }}>
              <option value="">수단 전체</option>
              <option value="email">이메일</option>
              <option value="phone">문자</option>
            </select>
            <button className="btn sm" disabled={pending} onClick={search}>찾기</button>
            <button className="btn sm" disabled={pending} onClick={() => { setQ(""); setKind(""); setPage(1); load({ page: 1 }); }}>초기화</button>
            <button className="btn sm" disabled={pending || list.rows.length === 0} onClick={csv}>이 페이지 CSV</button>
            <span style={{ fontSize: 11, color: "var(--ink3)" }}>
              {Object.entries(counts.bySource).map(([s, n]) => `${SOURCE_KO[s] ?? s} ${n}`).join(" · ") || "—"}
            </span>
          </div>

          {err && <div style={{ fontSize: 12.5, color: "#c92a2a" }}>{err}</div>}
          {msg && <div style={{ fontSize: 12.5, color: "#117a44" }}>{msg}</div>}

          <div style={{ overflowX: "auto" }}>
            <table className="t" style={{ fontSize: 12, minWidth: 720 }}>
              <thead><tr>
                <th>수단</th><th>주소(가림)</th><th>등록 경로</th><th>브랜드</th><th>메모</th>
                <th>최초 등록</th><th>최근 확인</th><th>확인</th><th></th>
              </tr></thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{KIND_KO[r.kind] ?? r.kind}</td>
                    <td><b>{r.addr_masked || "—"}</b></td>
                    <td>{SOURCE_KO[r.source] ?? r.source}</td>
                    <td>{r.brand_name ?? "—"}</td>
                    <td style={{ maxWidth: 200, whiteSpace: "pre-wrap" }}>{r.note || "—"}</td>
                    <td>{r.opted_out_at.slice(0, 16)}</td>
                    <td>{r.last_confirm_at.slice(0, 16)}</td>
                    <td>{r.confirm_count}</td>
                    <td>
                      {data.canEdit && r.source !== "link" ? (
                        <button className="btn sm" style={{ color: "#e03131" }} disabled={pending}
                          onClick={() => remove(r.id, r.addr_masked)}>해제</button>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--ink3)" }}>
                          {r.source === "link" ? "해제 불가" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {list.rows.length === 0 && (
                  <tr><td colSpan={9} style={{ color: "var(--ink3)" }}>
                    {q ? "정확히 일치하는 건이 없습니다." : "명단이 비어 있습니다."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {list.pages > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <button className="btn sm" disabled={pending || list.page <= 1} onClick={() => goPage(list.page - 1)}>이전</button>
              <span>{list.page} / {list.pages} (전체 {list.total}건)</span>
              <button className="btn sm" disabled={pending || list.page >= list.pages} onClick={() => goPage(list.page + 1)}>다음</button>
            </div>
          )}
        </div>
      </div>

      {data.canEdit && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="hd">
            <b>➕ 직접 등록</b>
            <span style={{ color: "var(--ink3)", fontSize: 11 }}>전화·메일로 받은 거부 요청을 담당자가 넣습니다 · 발송하지 않습니다</span>
          </div>
          <div className="bd" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input className="f" placeholder="이메일 또는 휴대폰 번호" value={addVal}
                onChange={(e) => setAddVal(e.target.value)} style={{ fontSize: 12, width: 260 }} />
              <input className="f" placeholder="사유·출처(이력에 남습니다)" value={addReason}
                onChange={(e) => setAddReason(e.target.value)} style={{ fontSize: 12, width: 260 }} />
              <button className="btn sm pri" disabled={pending || !addVal.trim()} onClick={addOne}>명단에 넣기</button>
              <button className="btn sm" disabled={pending} onClick={() => setBulkOpen((v) => !v)}>
                {bulkOpen ? "여러 건 닫기" : "여러 건 넣기"}
              </button>
            </div>
            {bulkOpen && (
              <div style={{ display: "grid", gap: 6 }}>
                <textarea className="f" rows={6} placeholder={"한 줄에 하나씩 적어주세요(쉼표도 됩니다)\n한 번에 200건까지"}
                  value={bulk} onChange={(e) => setBulk(e.target.value)} style={{ fontSize: 12.5 }} />
                <div>
                  <button className="btn sm pri" disabled={pending || !bulk.trim()} onClick={addBulk}>
                    {pending ? "등록 중…" : "일괄 등록"}
                  </button>
                  <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink3)" }}>
                    위에 적은 사유가 모든 건에 함께 저장됩니다.
                  </span>
                </div>
              </div>
            )}
            <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.8 }}>
              이미 명단에 있으면 새로 만들지 않고 <b>확인 횟수</b>만 올립니다.
              고객이 수신거부 링크를 직접 누른 건은 <b>해제할 수 없습니다</b> — 사람의 의사표시를 담당자가 뒤집지 않습니다.
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="hd">
          <b>🧾 변경 이력</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>최근 50건 · 누가 왜 넣고 뺐는지</span>
        </div>
        <div className="bd" style={{ overflowX: "auto" }}>
          <table className="t" style={{ fontSize: 12, minWidth: 620 }}>
            <thead><tr><th>시각</th><th>동작</th><th>수단</th><th>주소(가림)</th><th>사유</th><th>처리</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.at.slice(0, 16)}</td>
                  <td style={{ color: e.action === "remove" ? "#c25400" : "#117a44" }}>
                    {e.action === "remove" ? "해제" : "등록"}
                  </td>
                  <td>{KIND_KO[e.kind] ?? e.kind}</td>
                  <td>{e.addr_masked || "—"}</td>
                  <td style={{ maxWidth: 260, whiteSpace: "pre-wrap" }}>{e.reason || "—"}</td>
                  <td>{e.actor || "—"}</td>
                </tr>
              ))}
              {events.length === 0 && <tr><td colSpan={6} style={{ color: "var(--ink3)" }}>이력이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
