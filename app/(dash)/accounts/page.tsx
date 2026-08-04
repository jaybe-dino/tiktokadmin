import ScreenHeader from "@/components/ScreenHeader";
import AccountManager from "@/components/AccountManager";
import { currentUser } from "@/lib/auth";
import { accountList } from "@/lib/repo/queries";

export const dynamic = "force-dynamic";

// 계정·권한 관리 — 로그인 이메일/비번·권한·활성·삭제·Zoom 이메일. 파트장/대표만 편집.
export default async function AccountsPage() {
  const user = (await currentUser())!;
  const canEdit = user.role === "lead" || user.role === "exec";
  const accounts = await accountList();

  const active = accounts.filter((a) => a.active).length;
  const noPw = accounts.filter((a) => !a.has_password && a.active).length;

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="계정 · 권한 관리"
        desc={`계정 ${accounts.length} · 활성 ${active}${noPw ? ` · 비번 미설정 ${noPw}` : ""}`}
        right={!canEdit ? <span className="chip chip-amb">읽기 전용 (편집은 파트장/대표만)</span> : undefined}
      />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="tile"><div className="tile-k">계정</div><div className="tile-v">{accounts.length}</div></div>
        <div className="tile"><div className="tile-k">활성</div><div className="tile-v">{active}</div></div>
        <div className="tile"><div className="tile-k">비번 미설정</div><div className="tile-v" style={{ color: noPw ? "var(--danger)" : undefined }}>{noPw}</div></div>
      </div>
      <AccountManager accounts={accounts} meId={user.id} canEdit={canEdit} />
    </div>
  );
}
