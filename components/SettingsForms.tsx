"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addRequirementAction, deleteRequirementAction, toggleRequirementAction,
  updateSlaPolicyAction, upsertAdminUserAction,
} from "@/app/actions";
import { STATE_LABELS, type State } from "@/lib/types";

export function SlaPolicyEditor({
  policies,
}: {
  policies: { state: string; max_days: number; note: string }[];
}) {
  const router = useRouter();
  return (
    <div className="space-y-2">
      {policies.map((p) => (
        <form
          key={p.state}
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await updateSlaPolicyAction(p.state, Number(f.get("max_days")));
            router.refresh();
          }}
        >
          <span className="w-32 text-sm">{STATE_LABELS[p.state as State] ?? p.state}</span>
          <input name="max_days" type="number" className="input w-24" defaultValue={p.max_days} min={0} />
          <span className="text-xs text-muted flex-1">{p.note}</span>
          <button className="btn text-xs py-1" type="submit">저장</button>
        </form>
      ))}
    </div>
  );
}

interface Requirement {
  id: string;
  state: string;
  kind: "check" | "field";
  field_key: string | null;
  label: string;
  active: boolean;
}

const REQ_STATES: State[] = [
  "lead_new", "seminar", "meeting", "contact", "contract_review",
  "contract_done", "docs", "setup", "live_mall", "live_onboarding", "settling",
];

export function RequirementsEditor({ requirements }: { requirements: Requirement[] }) {
  const router = useRouter();
  const byState = (s: string) => requirements.filter((r) => r.state === s);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        각 단계에서 <b>무조건 체크·입력되어야 하는 항목</b>. 미충족 시 다음 단계로 이동이 차단됩니다.
        (<b>check</b>=담당자 체크 / <b>field</b>=브랜드 필드값 필수)
      </p>

      {REQ_STATES.map((s) => {
        const items = byState(s);
        return (
          <div key={s} className="border border-[#efe6ee] rounded-lg p-3">
            <div className="font-semibold text-sm mb-2">{STATE_LABELS[s]}</div>
            <div className="space-y-1 mb-2">
              {items.length === 0 && <div className="text-xs text-muted">항목 없음</div>}
              {items.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-sm">
                  <span className={`pill ${r.kind === "field" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                    {r.kind}
                  </span>
                  <span className={`flex-1 ${r.active ? "" : "line-through text-muted"}`}>
                    {r.label}
                    {r.field_key && <span className="text-muted"> · {r.field_key}</span>}
                  </span>
                  <button
                    className="text-xs text-muted hover:text-pink"
                    onClick={async () => { await toggleRequirementAction(r.id, !r.active); router.refresh(); }}
                  >
                    {r.active ? "비활성" : "활성화"}
                  </button>
                  <button
                    className="text-xs text-bad hover:underline"
                    onClick={async () => { await deleteRequirementAction(r.id); router.refresh(); }}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const kind = String(f.get("kind")) as "check" | "field";
                await addRequirementAction({
                  state: s,
                  kind,
                  field_key: kind === "field" ? String(f.get("field_key")) || undefined : undefined,
                  label: String(f.get("label")),
                });
                (e.target as HTMLFormElement).reset();
                router.refresh();
              }}
            >
              <select name="kind" className="input w-24 text-xs">
                <option value="check">check</option>
                <option value="field">field</option>
              </select>
              <input name="label" className="input flex-1 text-xs" placeholder="항목 이름 (예: 계약서 서명본 수령)" required />
              <input name="field_key" className="input w-32 text-xs" placeholder="필드명(field일때)" />
              <button className="btn text-xs py-1" type="submit">추가</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

export function AdminUserForm() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  return (
    <form
      className="grid grid-cols-2 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const res = await upsertAdminUserAction({
          id: String(f.get("id")),
          name: String(f.get("name")),
          role: String(f.get("role")),
          slack_user_id: String(f.get("slack_user_id")) || undefined,
        });
        setMsg(res.ok ? "저장됨" : res.error || "실패");
        router.refresh();
      }}
    >
      <input name="id" className="input" placeholder="이메일(id)" required />
      <input name="name" className="input" placeholder="이름" required />
      <select name="role" className="input" defaultValue="intake">
        {["intake", "sales", "onboard", "ads", "settle", "lead", "exec"].map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <input name="slack_user_id" className="input" placeholder="Slack User ID (선택)" />
      <button className="btn btn-primary col-span-2" type="submit">추가/수정</button>
      {msg && <span className="text-xs text-muted col-span-2">{msg}</span>}
    </form>
  );
}
