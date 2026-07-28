import Link from "next/link";
import { GradeBadge, PayBadge, StateBadge } from "@/components/badges";
import { customersList } from "@/lib/repo/queries";
import { SOURCE_LABELS, SOURCES, STATE_LABELS, STATES, GRADES } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; source?: string; grade?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const { rows, total, page, pages } = await customersList({
    q: sp.q, state: sp.state, source: sp.source, grade: sp.grade,
    page: sp.page ? Number(sp.page) : 1,
  });

  const qs = (over: Record<string, string | number>) => {
    const params = new URLSearchParams();
    const merged = { q: sp.q, state: sp.state, source: sp.source, grade: sp.grade, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, String(v));
    return `/customers?${params.toString()}`;
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-extrabold">고객 목록 <span className="text-base text-muted font-normal">({total})</span></h1>
        <Link href="/import" className="btn btn-primary">+ 브랜드 추가</Link>
      </div>

      {/* 검색·필터 */}
      <form method="GET" className="card p-3 mb-4 flex flex-wrap gap-2 items-end">
        <input name="q" defaultValue={sp.q ?? ""} className="input flex-1 min-w-[180px]" placeholder="브랜드명·이메일·전화 검색" />
        <select name="state" defaultValue={sp.state ?? ""} className="input w-40">
          <option value="">전체 단계</option>
          {STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className="input w-36">
          <option value="">전체 유입</option>
          {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
        </select>
        <select name="grade" defaultValue={sp.grade ?? ""} className="input w-24">
          <option value="">등급</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <button className="btn btn-primary" type="submit">검색</button>
        <Link href="/customers" className="btn">초기화</Link>
      </form>

      {/* 테이블 */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-[#efe6ee]">
              <th className="py-2 px-3">브랜드</th><th>단계</th><th>등급</th><th>결제</th><th>담당</th><th>유입</th><th>다음 액션</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">결과 없음</td></tr>}
            {rows.map((b) => (
              <tr key={b.id} className={`border-b border-[#f6eef4] hover:bg-[#fff8fb] ${b.has_breach ? "bg-red-50/40" : ""}`}>
                <td className="py-2 px-3">
                  <Link href={`/brand/${b.id}`} className="font-semibold hover:text-pink">{b.brand_name}</Link>
                  <div className="text-[11px] text-muted">{b.email ?? b.phone ?? "—"}</div>
                </td>
                <td><StateBadge state={b.state} /></td>
                <td><GradeBadge grade={b.grade} /></td>
                <td><PayBadge status={b.pay_status} /></td>
                <td className="text-xs text-muted max-w-[140px] truncate">{b.owners_display ?? "미지정"}</td>
                <td className="text-xs text-muted">{(b.sites ?? "").split(",").filter(Boolean).join(", ") || SOURCE_LABELS[b.source] || "—"}</td>
                <td className="text-xs max-w-[160px] truncate">{b.next_action || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4 text-sm">
          {page > 1 && <Link href={qs({ page: page - 1 })} className="btn text-xs py-1">← 이전</Link>}
          <span className="text-muted">{page} / {pages}</span>
          {page < pages && <Link href={qs({ page: page + 1 })} className="btn text-xs py-1">다음 →</Link>}
        </div>
      )}
    </div>
  );
}
