import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import CsvExportButton from "./CsvExportButton";
import { GradeBadge, PayBadge, PlanBadge, StateBadge } from "@/components/badges";
import { adminUserList, customersList } from "@/lib/repo/queries";
import { PLAN_LABELS, PLANS, SOURCE_LABELS, SOURCES, STATE_LABELS, STATES, GRADES } from "@/lib/types";

export const dynamic = "force-dynamic";

// 담당자 이니셜 (한글 성 첫 글자 / 영문 이니셜)
function initials(name: string): string {
  const n = name.trim();
  if (!n) return "?";
  if (/[가-힣]/.test(n)) return n.slice(0, 1);
  return n.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
}

// 마지막 접촉 경과 (상대 표기)
function sinceLabel(iso: string | null): { text: string; danger: boolean } {
  if (!iso) return { text: "—", danger: false };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { text: "—", danger: false };
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return { text: "오늘", danger: false };
  if (days === 1) return { text: "어제", danger: false };
  return { text: `${days}일 전`, danger: days >= 7 };
}

// 완성도: 카드 필수 필드 충족률
function completeness(b: Record<string, unknown>): number {
  const keys = ["brand_name", "category", "state", "grade", "plan", "source", "owner_sales", "email", "next_action"];
  const filled = keys.filter((k) => {
    const v = b[k];
    return v !== null && v !== undefined && String(v).trim() !== "";
  }).length;
  const cn = (b.countries as string[] | null)?.length ? 1 : 0;
  return Math.round(((filled + cn) / (keys.length + 1)) * 100);
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; source?: string; grade?: string; plan?: string; owner?: string; breach?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const breachOn = sp.breach === "1";
  // 모든 필터(plan/owner/breach 포함)를 서버 WHERE 로 내려 전 페이지 대상으로 정확히 필터·페이지네이션.
  const { rows, total, page, pages } = await customersList({
    q: sp.q, state: sp.state, source: sp.source, grade: sp.grade,
    plan: sp.plan, owner: sp.owner, breach: breachOn,
    page: sp.page ? Number(sp.page) : 1,
  });

  // 담당자 옵션 — value=id(저장값과 일치), 표시=name.
  const admins = await adminUserList().catch(() => []);
  const ownerOptions = admins.filter((a) => a.name).map((a) => ({ id: a.id, name: a.name }));

  const baseParams = { q: sp.q, state: sp.state, source: sp.source, grade: sp.grade, plan: sp.plan, owner: sp.owner, breach: sp.breach };
  const qs = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...baseParams, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, String(v));
    return `/customers?${params.toString()}`;
  };

  const start = total === 0 ? 0 : (page - 1) * 50 + 1;
  const end = Math.min(page * 50, total);

  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="브랜드 원장"
        desc={`${total}개 브랜드 · 1브랜드 = 1행 · 중복 0 · 완성도는 카드 필수 필드 충족률`}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <CsvExportButton filter={baseParams} />
            <Link href="/import" className="btn btn-primary">+ 등록</Link>
          </div>
        }
      />

      {/* 검색·필터 바 */}
      <form method="GET" className="bar">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          style={{ width: 220 }}
          placeholder="브랜드·담당자·이메일 검색"
        />
        <select name="state" defaultValue={sp.state ?? ""} style={{ width: 150 }}>
          <option value="">상태 전체</option>
          {STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
        </select>
        <select name="grade" defaultValue={sp.grade ?? ""} style={{ width: 110 }}>
          <option value="">등급 전체</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select name="plan" defaultValue={sp.plan ?? ""} style={{ width: 170 }}>
          <option value="">플랜 전체</option>
          {PLANS.map((pl) => <option key={pl} value={pl}>{PLAN_LABELS[pl]}</option>)}
        </select>
        <select name="owner" defaultValue={sp.owner ?? ""} style={{ width: 130 }}>
          <option value="">담당 전체</option>
          {ownerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} style={{ width: 150 }}>
          <option value="">유입 전체</option>
          {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
        </select>
        {/* SLA 위반 토글은 링크칩으로 유지되도록 hidden 으로 폼에 반영 */}
        {breachOn && <input type="hidden" name="breach" value="1" />}
        <button className="btn btn-primary btn-sm" type="submit">검색</button>
        <Link href={qs({ breach: breachOn ? undefined : "1", page: undefined })} className={`chip ${breachOn ? "chip-red" : ""}`}>
          {breachOn ? "필터: SLA 위반만 ✕" : "SLA 위반만"}
        </Link>
        <Link href="/customers" className="btn btn-sm">초기화</Link>
      </form>

      {/* 원장 테이블 */}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="t">
          <thead>
            <tr>
              <th>브랜드</th>
              <th>상태</th>
              <th>등급</th>
              <th>플랜 / 결제</th>
              <th>국가</th>
              <th>담당 (영업·온보딩)</th>
              <th>마지막 접촉</th>
              <th>완성도</th>
              <th>SLA</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: "28px 12px", textAlign: "center", color: "var(--ink3)" }}>
                  결과 없음
                </td>
              </tr>
            )}
            {rows.map((raw) => {
              const b = raw as unknown as Record<string, unknown>;
              const id = String(b.id);
              const category = (b.category as string) || "";
              const site = (b.sites as string | null)?.split(",").filter(Boolean)[0] ?? (b.brand_url as string | null) ?? "";
              const source = b.source as string;
              const sub = [category, site, SOURCE_LABELS[source] ?? source].filter(Boolean).join(" · ");
              const countries = (b.countries as string[] | null) ?? [];
              const ctyLabel = countries.length === 0 ? "—" : countries.length > 3 ? `${countries.length}개국` : countries.join("·");
              const ownerSales = b.owner_sales as string | null;
              const ownerOnboard = b.owner_onboard as string | null;
              const unassigned = !ownerSales && !ownerOnboard;
              const contact = sinceLabel(b.last_contact_at as string | null);
              const pct = completeness(b);
              const breach = Boolean(b.has_breach);

              return (
                <tr
                  key={id}
                  style={{ cursor: "pointer", background: breach ? "rgba(254,226,226,.35)" : undefined }}
                >
                  <td>
                    <Link href={`/brand/${id}`} style={{ fontWeight: 700, color: "inherit" }}>
                      {b.brand_name as string}
                    </Link>
                    {sub && <span className="sub">{sub}</span>}
                  </td>
                  <td><StateBadge state={b.state as never} /></td>
                  <td><GradeBadge grade={b.grade as never} /></td>
                  <td>
                    {b.plan ? <PlanBadge plan={b.plan as never} /> : <span style={{ color: "var(--ink3)" }}>—</span>}
                    <span className="sub">
                      {b.pay_status ? <PayBadge status={b.pay_status as string} /> : "미결제"}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{ctyLabel}</td>
                  <td>
                    {unassigned ? (
                      <span style={{ color: "var(--danger)", fontWeight: 700 }}>미배정</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {ownerSales && <span className="av" title={`영업 ${ownerSales}`}>{initials(ownerSales)}</span>}
                        {ownerOnboard && <span className="av" title={`온보딩 ${ownerOnboard}`}>{initials(ownerOnboard)}</span>}
                        <span className="sub" style={{ display: "inline" }}>
                          {ownerSales ?? "—"} · {ownerOnboard ?? "—"}
                        </span>
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap", color: contact.danger ? "var(--danger)" : undefined }}>
                    {contact.text}
                  </td>
                  <td style={{ minWidth: 80 }}>
                    <div className="pr">
                      <i className={pct >= 90 ? "g" : pct >= 50 ? "" : "w"} style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  <td>
                    {breach ? (
                      <span className="sla t2">위반</span>
                    ) : contact.danger ? (
                      <span className="sla t1">지연</span>
                    ) : (
                      <span className="sla ok">정상</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "10px 16px", color: "var(--ink3)", fontSize: 11.5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{`${start}–${end} / ${total}`}</span>
          {pages > 1 && (
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {page > 1 && <Link href={qs({ page: page - 1 })} className="btn btn-sm">‹ 이전</Link>}
              <span>{page} / {pages}</span>
              {page < pages && <Link href={qs({ page: page + 1 })} className="btn btn-sm">다음 ›</Link>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
