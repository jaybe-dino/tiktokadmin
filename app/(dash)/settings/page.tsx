import { AdminUserForm, SlaPolicyEditor } from "@/components/SettingsForms";
import { currentUser } from "@/lib/auth";
import { adminUserList, slaPolicyList } from "@/lib/repo/queries";
import { DOC_TEMPLATES } from "@/lib/docs";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = (await currentUser())!;
  const canEdit = user.role === "lead" || user.role === "exec";
  const [policies, users] = await Promise.all([slaPolicyList(), adminUserList()]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-extrabold mb-1">설정</h1>
      {!canEdit && <p className="text-sm text-bad mb-4">읽기 전용 (편집은 파트장/대표만)</p>}

      <section className="card p-4 mb-4">
        <h2 className="font-bold mb-2">SLA 정책 (영업일)</h2>
        {canEdit ? (
          <SlaPolicyEditor policies={policies} />
        ) : (
          <div className="text-sm space-y-1">
            {policies.map((p) => (
              <div key={p.state}>{p.state}: {p.max_days}일 · {p.note}</div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-4 mb-4">
        <h2 className="font-bold mb-2">담당자 ({users.length})</h2>
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-[#efe6ee]">
              <th className="py-1">이메일</th><th>이름</th><th>역할</th><th>Slack</th><th>활성</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[#f6eef4]">
                <td className="py-1">{u.id}</td><td>{u.name}</td><td>{u.role}</td>
                <td className="text-xs">{u.slack_user_id ?? "—"}</td>
                <td>{u.active ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && <AdminUserForm />}
      </section>

      <section className="card p-4">
        <h2 className="font-bold mb-2">서류 템플릿</h2>
        {(["mall", "onboarding"] as const).map((t) => (
          <div key={t} className="mb-2">
            <div className="text-sm font-semibold">{t}</div>
            <div className="text-xs text-muted">{DOC_TEMPLATES[t].map((i) => i.label).join(" · ")}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
