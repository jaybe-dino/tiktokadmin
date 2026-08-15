import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import TpartnersImport from "@/components/TpartnersImport";

export const dynamic = "force-dynamic";

export default async function ImportTpartnersPage() {
  const u = await currentUser();
  const allowed = !!u && (u.role === "exec" || u.role === "lead");

  return (
    <div className="max-w-4xl">
      <ScreenHeader
        title="tpartners 데이터 이관"
        desc="apply.tpartners.live 번들 → 브랜드 원장. 터미널 없이 파일 업로드로 진행(대표·파트장 전용)."
      />
      {allowed ? (
        <TpartnersImport />
      ) : (
        <div className="card"><div className="card-bd"><p className="note">대표·파트장만 사용할 수 있습니다.</p></div></div>
      )}
    </div>
  );
}
