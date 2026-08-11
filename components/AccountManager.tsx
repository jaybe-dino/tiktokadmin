"use client";
// 계정 관리 — 이메일·이름·권한·zoom_email·비밀번호·활성·삭제. 파트장/대표만 편집.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAccountAction, setAccountActiveAction, deleteAccountAction, setPasswordAction } from "@/app/actions";
import type { AccountRow } from "@/lib/repo/queries";

// admin_users.role CHECK 제약과 일치(0001_init). 담당(직원) 5개 + 관리 2개.
const STAFF_ROLES: [string, string][] = [
  ["intake", "리드접수"], ["sales", "영업"], ["onboard", "온보딩"], ["ads", "광고"], ["settle", "정산"],
];
const MGR_ROLES: [string, string][] = [["lead", "파트장"], ["exec", "대표"]];
const ROLE_LABEL: Record<string, string> = {
  intake: "리드접수", sales: "영업", onboard: "온보딩", ads: "광고", settle: "정산", lead: "파트장", exec: "대표",
};

function RoleSelect({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <select className="input" defaultValue={value} disabled={disabled} style={{ padding: "2px 6px", fontSize: 12 }}
      onChange={(e) => onChange(e.target.value)}>
      {!ROLE_LABEL[value] && <option value={value}>{value}</option>}
      <optgroup label="담당(직원)">{STAFF_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
      <optgroup label="관리">{MGR_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
    </select>
  );
}

export default function AccountManager({ accounts, meId, canEdit }: { accounts: AccountRow[]; meId: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pw, setPw] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? okMsg : r.error ?? "실패");
      // 성공·실패 모두 새로고침 — 실패 시 uncontrolled 셀렉트(역할)를 실제 값으로 되돌린다.
      router.refresh();
    });

  return (
    <div className="card">
      <div className="card-hd">
        <b>계정 · 권한</b>
        <span style={{ color: "var(--ink3)", fontSize: 11 }}>{accounts.length}명 · 로그인 이메일/비번·권한·삭제</span>
        {canEdit && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenAdd((v) => !v)}>{openAdd ? "닫기" : "+ 계정 추가"}</button>}
      </div>

      {openAdd && canEdit && <AccountForm onDone={() => { setOpenAdd(false); router.refresh(); }} setMsg={setMsg} />}

      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr><th>이메일(로그인 ID)</th><th>이름</th><th>권한</th><th>Zoom 이메일</th><th>비번</th><th>상태</th>{canEdit && <th>관리</th>}</tr></thead>
          <tbody>
            {accounts.length === 0 && <tr><td colSpan={7} style={{ color: "var(--ink3)" }}>계정이 없습니다.</td></tr>}
            {accounts.map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                <td><b>{u.id}</b>{u.id === meId && <span className="pill" style={{ fontSize: 10, marginLeft: 4 }}>나</span>}</td>
                <td>{u.name}</td>
                <td>
                  {canEdit ? (
                    <RoleSelect value={u.role}
                      onChange={(v) => run(() => saveAccountAction({ id: u.id, name: u.name, role: v, zoom_email: u.zoom_email ?? "" }), "권한 변경됨")} />
                  ) : ROLE_LABEL[u.role] ?? u.role}
                </td>
                <td style={{ fontSize: 12, color: "var(--ink3)" }}>
                  {canEdit ? (
                    <ZoomEmailCell u={u} disabled={pending}
                      onSave={(val) => run(() => saveAccountAction({ id: u.id, name: u.name, role: u.role, zoom_email: val }), "Zoom 이메일 저장됨")} />
                  ) : (u.zoom_email || "—")}
                </td>
                <td>{u.has_password ? <span className="pill grn" style={{ fontSize: 10 }}>설정됨</span> : <span className="pill" style={{ fontSize: 10, background: "#fee2e2", color: "#b91c1c" }}>미설정</span>}</td>
                <td>{u.active ? <span className="pill grn" style={{ fontSize: 10 }}>활성</span> : <span className="pill" style={{ fontSize: 10 }}>비활성</span>}</td>
                {canEdit && (
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn btn-sm" disabled={pending} onClick={() => { setPwFor(pwFor === u.id ? null : u.id); setPw(""); }}>🔑 비번</button>
                      <button className="btn btn-sm" disabled={pending} onClick={() => run(() => setAccountActiveAction(u.id, !u.active), u.active ? "비활성됨" : "활성됨")}>{u.active ? "비활성" : "활성"}</button>
                      <button className="btn btn-sm" disabled={pending} style={{ color: "var(--danger)" }}
                        onClick={() => { if (confirm(`${u.id} 계정을 삭제할까요? (담당 지정은 해제됩니다)`)) run(() => deleteAccountAction(u.id), "삭제됨"); }}>삭제</button>
                    </div>
                    {pwFor === u.id && (
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <input className="input" type="password" placeholder="새 비밀번호(6자+)" value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: 150, fontSize: 12 }} />
                        <button className="btn btn-sm btn-primary" disabled={pending || pw.length < 6}
                          onClick={() => run(async () => { const r = await setPasswordAction(u.id, pw); if (r.ok) { setPwFor(null); setPw(""); } return r; }, "비밀번호 설정됨")}>저장</button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="note" style={{ margin: "8px 16px", color: "var(--ok)" }}>{msg}</div>}
      <div className="note" style={{ margin: "0 16px 14px" }}>
        <b>권한</b>: 대표=전체 · 파트장=편집·계정관리 · 담당(리드접수/영업/온보딩/광고/정산)=담당 범위. <b>Zoom 이메일</b>은 그 담당자가 연 미팅 녹화를 자동 귀속하는 데 씁니다.
        본인 계정·마지막 대표는 비활성/삭제할 수 없습니다.
      </div>
    </div>
  );
}

// Zoom 이메일 인라인 편집 — 줌 호스트(미팅 녹화/캘린더) → 담당자 귀속 매핑.
function ZoomEmailCell({ u, disabled, onSave }: { u: AccountRow; disabled?: boolean; onSave: (val: string) => void }) {
  const [val, setVal] = useState(u.zoom_email ?? "");
  const dirty = (val.trim() || "") !== (u.zoom_email ?? "");
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        className="input" value={val} disabled={disabled} placeholder="zoom 로그인 이메일"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && dirty) onSave(val.trim()); }}
        style={{ width: 170, fontSize: 12, padding: "2px 6px" }}
      />
      {dirty && (
        <button className="btn btn-sm btn-primary" disabled={disabled} onClick={() => onSave(val.trim())} title="저장">저장</button>
      )}
    </span>
  );
}

function AccountForm({ onDone, setMsg }: { onDone: () => void; setMsg: (s: string) => void }) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({ id: "", name: "", role: "intake", zoom_email: "", password: "" });
  return (
    <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div><label className="label">이메일(로그인 ID)</label><input className="input" style={{ width: 200 }} placeholder="name@dinostudio.kr" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} /></div>
      <div><label className="label">이름</label><input className="input" style={{ width: 120 }} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="label">권한</label>
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <optgroup label="담당(직원)">{STAFF_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
          <optgroup label="관리">{MGR_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
        </select>
      </div>
      <div><label className="label">Zoom 이메일(선택)</label><input className="input" style={{ width: 180 }} placeholder="zoom 로그인 이메일" value={f.zoom_email} onChange={(e) => setF({ ...f, zoom_email: e.target.value })} /></div>
      <div><label className="label">초기 비밀번호(6자+)</label><input className="input" type="password" style={{ width: 150 }} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      <button className="btn btn-primary" disabled={pending || !f.id.includes("@")} onClick={() => start(async () => {
        const r = await saveAccountAction(f);
        if (r.ok) onDone(); else setMsg(r.error ?? "실패");
      })}>{pending ? "생성 중…" : "계정 생성"}</button>
    </div>
  );
}
