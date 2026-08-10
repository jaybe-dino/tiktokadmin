import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import CsvExportButton from "./CsvExportButton";
import CustomerTable from "@/components/CustomerTable";
import { adminUserList, customersList } from "@/lib/repo/queries";
import { currentUser } from "@/lib/auth";
import { PLAN_LABELS, PLANS, SOURCE_LABELS, SOURCES, STATE_LABELS, STATES, GRADES } from "@/lib/types";

export const dynamic = "force-dynamic";

const SORT_OPTS: [string, string][] = [
  ["updated", "최근 업데이트순"],
  ["created", "리드 추가순(최신)"],
  ["created_asc", "리드 추가순(오래된)"],
  ["contact", "마지막 접촉순"],
  ["name", "이름순"],
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; source?: string; grade?: string; plan?: string; owner?: string; breach?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const breachOn = sp.breach === "1";
  const sort = sp.sort ?? "updated";
  const [{ rows, total, page, pages }, user] = await Promise.all([
    customersList({
      q: sp.q, state: sp.state, source: sp.source, grade: sp.grade,
      plan: sp.plan, owner: sp.owner, breach: breachOn, sort,
      page: sp.page ? Number(sp.page) : 1,
    }),
    currentUser(),
  ]);
  const canEdit = user?.role === "lead" || user?.role === "exec";

  const admins = await adminUserList().catch(() => []);
  const ownerOptions = admins.filter((a) => a.name).map((a) => ({ id: a.id, name: a.name }));

  const baseParams = { q: sp.q, state: sp.state, source: sp.source, grade: sp.grade, plan: sp.plan, owner: sp.owner, breach: sp.breach, sort: sp.sort };
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
        desc={`${total}개 브랜드 · 1브랜드 = 1행 · 중복 0${canEdit ? " · 체크 후 일괄 삭제 가능" : ""}`}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <CsvExportButton filter={baseParams} />
            <Link href="/import" className="btn btn-primary">+ 등록</Link>
          </div>
        }
      />

      {/* 검색·필터·정렬 바 */}
      <form method="GET" className="bar">
        <input name="q" defaultValue={sp.q ?? ""} style={{ width: 200 }} placeholder="브랜드·담당자·이메일 검색" />
        <select name="state" defaultValue={sp.state ?? ""} style={{ width: 140 }}>
          <option value="">상태 전체</option>
          {STATES.map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
        </select>
        <select name="grade" defaultValue={sp.grade ?? ""} style={{ width: 100 }}>
          <option value="">등급 전체</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select name="plan" defaultValue={sp.plan ?? ""} style={{ width: 150 }}>
          <option value="">플랜 전체</option>
          {PLANS.map((pl) => <option key={pl} value={pl}>{PLAN_LABELS[pl]}</option>)}
        </select>
        <select name="owner" defaultValue={sp.owner ?? ""} style={{ width: 120 }}>
          <option value="">담당 전체</option>
          {ownerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} style={{ width: 140 }}>
          <option value="">유입 전체</option>
          {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
        </select>
        <select name="sort" defaultValue={sort} style={{ width: 160 }} title="정렬">
          {SORT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {breachOn && <input type="hidden" name="breach" value="1" />}
        <button className="btn btn-primary btn-sm" type="submit">검색·정렬</button>
        <Link href={qs({ breach: breachOn ? undefined : "1", page: undefined })} className={`chip ${breachOn ? "chip-red" : ""}`}>
          {breachOn ? "필터: SLA 위반만 ✕" : "SLA 위반만"}
        </Link>
        <Link href="/customers" className="btn btn-sm">초기화</Link>
      </form>

      {/* 원장 테이블 (체크박스 일괄삭제 + 날짜 컬럼) */}
      <CustomerTable rows={rows as unknown as Record<string, unknown>[]} canEdit={canEdit} ownerNames={Object.fromEntries(admins.map((a) => [a.id, a.name]))} owners={ownerOptions} />

      <div style={{ padding: "10px 4px", color: "var(--ink3)", fontSize: 11.5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
  );
}
