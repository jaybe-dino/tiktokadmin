"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSlaPolicyAction, upsertAdminUserAction } from "@/app/actions";
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
