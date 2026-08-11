import Link from "next/link";
import { onboardingPipeline, ONB_STAGES } from "@/lib/onboarding-pipeline";
import { adminUserList } from "@/lib/repo/queries";

export const dynamic = "force-dynamic";

const STAGE_DOT: Record<string, string> = {
  invite: "#6366f1", company: "#0891b2", signup: "#16a34a", product: "#d97706", ready: "#7c3aed",
};

export default async function OnboardingPipelinePage() {
  const [groups, admins] = await Promise.all([
    onboardingPipeline().catch(() => null),
    adminUserList().catch(() => []),
  ]);
  const nm = (id: string | null) => (id ? (admins.find((a) => a.id === id)?.name ?? id) : null);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>온보딩 파이프라인</h1>
          <p>영업 파이프라인 서류수급 진입 브랜드부터 — 서류준비/Invite → 기업정보 등록 → 가입 완료 → 제품 등록 → 운영 준비. 단계는 온보딩 신청 진행상태로 자동 파생됩니다.</p>
        </div>
      </div>

      {groups === null ? (
        <div className="card" style={{ padding: 20, color: "var(--ink3)" }}>
          온보딩 데이터를 불러오지 못했습니다 — 온보딩 마이그레이션(0036~0038) 적용이 필요할 수 있습니다.
        </div>
      ) : (
        <div className="kb">
          {ONB_STAGES.map((st) => {
            const list = groups[st.key] ?? [];
            return (
              <div key={st.key} className="kcol">
                <h4>
                  <span className="dot" style={{ background: STAGE_DOT[st.key] }} />
                  {st.label}
                  <span className="c">{list.length}{st.slaDays != null && ` · SLA ${st.slaDays}일`}</span>
                </h4>
                <div style={{ fontSize: 10.5, color: "var(--ink3)", padding: "0 2px 6px" }}>{st.desc}</div>
                <div className="min-h-[60px]">
                  {list.length === 0 && <div style={{ fontSize: 12, color: "var(--ink3)", padding: 8 }}>없음</div>}
                  {list.map((c) => {
                    const owner = nm(c.owner_onboard);
                    return (
                      <Link key={c.brand_id} href={`/brand/${c.brand_id}`} className="kcard" style={{ display: "block", ...(c.overSla ? { borderColor: "#fca5a5" } : {}) }}>
                        <div className="nm"><span className="truncate">{c.brand_name}</span></div>
                        {st.key === "invite" && !c.app_status && (
                          <div className="mt" style={{ color: "#6366f1" }}>온보딩 계정(Invite) 발급 필요 →</div>
                        )}
                        {c.app_status && <div className="mt truncate">신청상태: {c.app_status}{c.product_count ? ` · 제품 ${c.product_count}` : ""}</div>}
                        <div className="ft">
                          {owner ? <span className="av" title={`온보딩 ${owner}`}>{owner.slice(0, 2)}</span>
                            : <><span className="av" style={{ background: "#94a3b8" }}>미</span><span style={{ fontSize: 10, color: "var(--danger)", fontWeight: 700 }}>담당 미배정</span></>}
                          {st.slaDays != null && (
                            <span className={`sla ${c.overSla ? "t2" : c.ageDays >= st.slaDays - 1 ? "t1" : "ok"}`}>
                              {c.overSla ? `+${c.ageDays - st.slaDays}일` : `D${c.ageDays}`}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="note" style={{ marginTop: 8 }}>
        💡 단계 전환은 온보딩 신청 승인·제품 등록으로 진행됩니다 — 카드를 클릭해 브랜드360에서 Invite 발급·정보 검토·승인·제품 등록을 처리하세요. 파트별 담당자 알림·SLA 규칙은 영업 파이프라인과 동일합니다.
      </div>
    </div>
  );
}
