"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  assignAction, docCheckAction, dropAction, logContactAction,
  manualPaymentAction, remindAction, stageCheckAction, transitionAction,
} from "@/app/actions";
import { FORWARD_TRANSITIONS } from "@/lib/states";
import { PLANS, PLAN_LABELS, STATE_LABELS, type Brand, type OwnerField, type State } from "@/lib/types";

interface StageReq {
  id: string;
  label: string;
  kind: string;
  field_key: string | null;
  done: boolean;
}

interface Props {
  brand: Brand;
  adminUsers: { id: string; name: string; role: string }[];
  docItems: { item_key: string; label: string; done: boolean; source: string }[];
  stageReqs: StageReq[];
}

const OWNER_ROLES: { field: OwnerField; label: string; role: string }[] = [
  { field: "owner_intake", label: "유입", role: "intake" },
  { field: "owner_sales", label: "영업", role: "sales" },
  { field: "owner_onboard", label: "온보딩", role: "onboard" },
  { field: "owner_ads", label: "광고", role: "ads" },
];

export default function Brand360Actions({ brand, adminUsers, docItems, stageReqs }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [dropReason, setDropReason] = useState("");

  function flash(t: string, bad = false) {
    setMsg({ t, bad });
    setTimeout(() => setMsg(null), 4000);
    router.refresh();
  }

  const nextStates = FORWARD_TRANSITIONS[brand.state] ?? [];

  async function move(to: State) {
    const res = await transitionAction(brand.id, to);
    if (res.ok) flash(`${STATE_LABELS[to]}로 이동`);
    else flash(res.failed?.map((f) => f.label).join(" · ") || res.error || "실패", true);
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm font-semibold ${msg.bad ? "bg-red-50 text-bad" : "bg-emerald-50 text-good"}`}>
          {msg.t}
        </div>
      )}

      {/* 현재 단계 필수항목 (관리자 설정 — 미충족 시 다음 단계 이동 차단) */}
      {stageReqs.length > 0 && (
        <div className="card p-4">
          <div className="label">이 단계 필수항목 · {STATE_LABELS[brand.state]}</div>
          <div className="space-y-1">
            {stageReqs.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                {r.kind === "check" ? (
                  <input
                    type="checkbox"
                    className="accent-pink w-4 h-4"
                    checked={r.done}
                    onChange={async (e) => {
                      await stageCheckAction(brand.id, r.id, e.target.checked);
                      router.refresh();
                    }}
                  />
                ) : (
                  <span className={`w-4 text-center ${r.done ? "text-good" : "text-bad"}`}>
                    {r.done ? "✓" : "!"}
                  </span>
                )}
                <span className={r.done ? "line-through text-muted" : ""}>{r.label}</span>
                {r.kind === "field" && (
                  <span className="pill bg-gray-100 text-gray-500">필드: {r.field_key} {r.done ? "" : "미입력"}</span>
                )}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-2">필수항목이 남아 있으면 다음 단계로 이동할 수 없습니다.</p>
        </div>
      )}

      {/* 상태 스테퍼 */}
      <div className="card p-4">
        <div className="label">상태 이동 (게이트 검증)</div>
        <div className="flex flex-wrap gap-2">
          {nextStates.length === 0 && <span className="text-sm text-muted">전진 가능한 다음 상태 없음</span>}
          {nextStates.map((s) => (
            <button key={s} className="btn btn-primary" onClick={() => move(s)}>
              {STATE_LABELS[s]} ▸
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input
            className="input flex-1"
            placeholder="드랍 사유"
            value={dropReason}
            onChange={(e) => setDropReason(e.target.value)}
          />
          <button
            className="btn btn-danger"
            onClick={async () => {
              const res = await dropAction(brand.id, dropReason);
              if (res.ok) flash("드랍 처리됨");
              else flash(res.error || "사유 필요", true);
            }}
          >
            드랍
          </button>
        </div>
      </div>

      {/* 담당 배정 */}
      <div className="card p-4">
        <div className="label">담당자</div>
        <div className="grid grid-cols-2 gap-2">
          {OWNER_ROLES.map((r) => (
            <div key={r.field}>
              <div className="text-[11px] text-muted mb-1">{r.label}</div>
              <select
                className="input"
                defaultValue={(brand[r.field] as string) ?? ""}
                onChange={async (e) => {
                  const res = await assignAction(brand.id, r.field, e.target.value);
                  flash(res.ok ? `${r.label} 담당 변경` : res.error || "실패", !res.ok);
                }}
              >
                <option value="">미지정</option>
                {adminUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* 서류 체크리스트 */}
      <div className="card p-4">
        <div className="label">서류 체크리스트</div>
        <div className="space-y-1">
          {docItems.length === 0 && <div className="text-sm text-muted">템플릿 없음 (계약완료 시 자동 생성)</div>}
          {docItems.map((it) => (
            <label key={it.item_key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-pink w-4 h-4"
                checked={it.done}
                disabled={it.source === "apply_step"}
                onChange={async (e) => {
                  const res = await docCheckAction(brand.id, it.item_key, e.target.checked);
                  if (!res.ok) flash(res.error || "실패", true);
                  else router.refresh();
                }}
              />
              <span className={it.done ? "line-through text-muted" : ""}>{it.label}</span>
              {it.source === "apply_step" && <span className="pill bg-gray-100 text-gray-500">apply 동기 🔒</span>}
            </label>
          ))}
        </div>
      </div>

      {/* 액션 바 */}
      <div className="card p-4 space-y-3">
        <div className="label">액션</div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={async () => { await logContactAction(brand.id, "call", "통화"); flash("접촉 기록"); }}>
            접촉 기록
          </button>
          <button
            className="btn"
            onClick={async () => {
              const res = await remindAction(brand.id, "email");
              setDraft(res.draft?.body ?? "");
              flash(res.sent ? "리마인더 발송됨" : "초안 생성(미발송)");
            }}
          >
            리마인더 초안
          </button>
        </div>
        {draft !== null && (
          <textarea className="input h-40 font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} />
        )}

        {/* 수기 결제 */}
        <details>
          <summary className="text-sm font-semibold cursor-pointer text-muted">수기 결제 입력 (Guarantee 등)</summary>
          <form
            className="grid grid-cols-2 gap-2 mt-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const res = await manualPaymentAction({
                brandId: brand.id,
                plan: String(f.get("plan")),
                amount: Number(f.get("amount")),
                paid_at: String(f.get("paid_at")),
                next_due: String(f.get("next_due")) || undefined,
                note: String(f.get("note")) || undefined,
              });
              flash(res.ok ? "수기 결제 기록됨" : res.error || "실패", !res.ok);
            }}
          >
            <select name="plan" className="input" defaultValue="guarantee_1m">
              {PLANS.map((p) => (
                <option key={p} value={p}>{PLAN_LABELS[p]}</option>
              ))}
            </select>
            <input name="amount" className="input" type="number" placeholder="금액(원)" required />
            <input name="paid_at" className="input" type="date" required />
            <input name="next_due" className="input" type="date" placeholder="다음 결제일" />
            <input name="note" className="input col-span-2" placeholder="메모" />
            <button className="btn btn-primary col-span-2" type="submit">기록</button>
          </form>
        </details>
      </div>
    </div>
  );
}
