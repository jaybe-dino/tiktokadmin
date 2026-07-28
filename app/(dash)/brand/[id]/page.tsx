import Link from "next/link";
import { notFound } from "next/navigation";
import Brand360Actions from "@/components/Brand360Actions";
import CustomerDetail from "@/components/CustomerDetail";
import { GradeBadge, PayBadge, PlanBadge, StateBadge, TierBadge } from "@/components/badges";
import { brand360 } from "@/lib/repo/queries";
import { stageChecklist } from "@/lib/requirements";
import { humanElapsed } from "@/lib/time";
import { SOURCE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await brand360(id);
  if (!data) notFound();
  const { brand, signals, docs, paymentsManual, glovekSubs, timeline, alerts, adminUsers, files, proposals } = data;

  // 현재 단계 필수항목. field형은 브랜드 값으로 done 판정.
  const rawReqs = await stageChecklist(brand.id, brand.state);
  const stageReqs = rawReqs.map((r) => {
    if (r.kind === "field" && r.field_key) {
      const v = (brand as unknown as Record<string, unknown>)[r.field_key];
      const done = Array.isArray(v) ? v.length > 0 : Boolean(v);
      return { ...r, done };
    }
    return r;
  });

  return (
    <div className="max-w-6xl">
      <Link href="/" className="text-sm text-muted hover:text-pink">← 보드</Link>

      {/* 헤더 */}
      <div className="card p-5 mt-2 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-extrabold">{brand.brand_name}</h1>
          <GradeBadge grade={brand.grade} />
          <StateBadge state={brand.state} />
          <PlanBadge plan={brand.plan} />
          <PayBadge status={brand.pay_status} />
          <span className="pill bg-gray-100 text-gray-600">{SOURCE_LABELS[brand.source] ?? brand.source}</span>
          {brand.churn_risk === "high" && <span className="pill bg-red-100 text-red-600">이탈위험 high</span>}
        </div>
        <div className="text-sm text-muted mt-2 flex flex-wrap gap-x-4">
          <span>{brand.email ?? "이메일 없음"}</span>
          <span>{brand.phone ?? "전화 없음"}</span>
          <span>사업자 {brand.biz_no ?? "—"}</span>
          <span>{brand.category || "카테고리 미상"}</span>
          <span>현 단계 {humanElapsed(brand.stage_entered_at)} 경과</span>
        </div>
        {alerts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {alerts.map((a) => (
              <span key={a.id} className="pill bg-red-50 text-bad flex items-center gap-1">
                <TierBadge tier={a.tier} /> {a.kind} · {a.message}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {/* 사전분석 브리프 */}
          <section className="card p-4">
            <h2 className="font-bold mb-2">사전분석 브리프</h2>
            {brand.brief_md ? (
              <pre className="whitespace-pre-wrap text-sm text-ink font-sans">{brand.brief_md}</pre>
            ) : (
              <p className="text-sm text-muted">브리프 미생성 (사전분석 에이전트 대기 중)</p>
            )}
            {signals.length > 0 && (
              <table className="w-full text-xs mt-3 border-t border-[#efe6ee]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1">출처</th><th>지표</th><th>값</th><th>신뢰도</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s, i) => (
                    <tr key={i} className="border-t border-[#f6eef4]">
                      <td className="py-1">{s.source}</td>
                      <td>{s.metric}</td>
                      <td>{s.value_num ?? s.value_text ?? "—"}</td>
                      <td>{s.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* 고객 상세 — 국가·자료(파일)·제안서 */}
          <CustomerDetail brand={brand} files={files} proposals={proposals} />

          {/* 결제 */}
          <section className="card p-4">
            <h2 className="font-bold mb-2">결제</h2>
            {glovekSubs.length > 0 && (
              <div className="mb-2">
                <div className="text-xs text-muted mb-1">glovek 정기(구독)</div>
                {glovekSubs.map((s, i) => (
                  <div key={i} className="text-sm flex justify-between">
                    <span>{s.plan} · {s.status}</span>
                    <span>{s.amount ? `₩${s.amount.toLocaleString()}` : ""} {s.next_charge_at ? `· ${s.next_charge_at.slice(0, 10)}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="text-xs text-muted mb-1">수기 결제</div>
            {paymentsManual.length === 0 ? (
              <p className="text-sm text-muted">없음</p>
            ) : (
              paymentsManual.map((p) => (
                <div key={p.id} className="text-sm flex justify-between">
                  <span>{p.plan} · {p.method}</span>
                  <span>₩{p.amount.toLocaleString()} · {p.paid_at}</span>
                </div>
              ))
            )}
          </section>

          {/* 타임라인 */}
          <section className="card p-4">
            <h2 className="font-bold mb-2">타임라인</h2>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {timeline.map((t, i) => (
                <div key={i} className="text-xs flex gap-2 border-b border-[#f6eef4] py-1">
                  <span className={`pill ${t.kind === "gate_fail" ? "bg-red-100 text-bad" : "bg-gray-100 text-gray-600"}`}>
                    {t.kind}
                  </span>
                  <span className="flex-1">{t.text}</span>
                  <span className="text-muted whitespace-nowrap">{t.at.slice(5, 16).replace("T", " ")}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* 액션 (client) */}
        <Brand360Actions
          brand={brand}
          adminUsers={adminUsers}
          docItems={docs.items.map((i) => ({ item_key: i.item_key, label: i.label, done: i.done, source: i.source }))}
          stageReqs={stageReqs}
        />
      </div>
    </div>
  );
}
