import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { GradeBadge } from "@/components/badges";
import { query } from "@/lib/db";
import { GRADES, type Grade } from "@/lib/types";

export const dynamic = "force-dynamic";

const TEMPLATE_KO: Record<string, string> = { mall: "멀티몰", onboarding: "온보딩" };

const LOGI_ST: Record<string, { ko: string; cc: string }> = {
  none: { ko: "대기", cc: "cc-no" },
  negotiating: { ko: "협의", cc: "cc-ing" },
  contracted: { ko: "계약", cc: "cc-ok" },
  active: { ko: "운영", cc: "cc-ok" },
  expired: { ko: "만료", cc: "cc-exp" },
};

const COUNTRIES: { code: string; flag: string }[] = [
  { code: "US", flag: "🇺🇸" },
  { code: "VN", flag: "🇻🇳" },
  { code: "TH", flag: "🇹🇭" },
  { code: "MY", flag: "🇲🇾" },
  { code: "SG", flag: "🇸🇬" },
];

interface DocRow {
  id: string;
  brand_name: string;
  grade: string | null;
  templates: string | null;
  total: number;
  done_cnt: number;
  pending_cnt: number;
  pending_labels: string | null;
}

interface LogiRow {
  brand_id: string;
  brand_name: string;
  grade: string | null;
  country: string;
  provider: string | null;
  status: string | null;
  end_date: string | null;
}

interface LogRow {
  brand_name: string;
  grade: string | null;
  template: string | null;
  label: string;
  done_at: string | null;
  done_by: string | null;
}

export default async function DocsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; grade?: string; country?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const grade = sp.grade ?? "";
  const country = sp.country ?? "";
  const matchBrand = (name: string, g: string | null) =>
    (!q || (name ?? "").toLowerCase().includes(q)) && (!grade || g === grade);
  const filterActive = Boolean(q || grade || country);

  const docRows = (await query(
    `SELECT b.id, b.brand_name, b.grade,
            string_agg(DISTINCT d.template, ',') AS templates,
            count(*)::int AS total,
            count(*) FILTER (WHERE d.done)::int AS done_cnt,
            count(*) FILTER (WHERE NOT d.done)::int AS pending_cnt,
            COALESCE(string_agg(d.label, ' · ') FILTER (WHERE NOT d.done), '') AS pending_labels
       FROM doc_items d
       JOIN brands b ON b.id = d.brand_id
      WHERE COALESCE(b.is_test, false) = false
      GROUP BY b.id, b.brand_name, b.grade
     HAVING count(*) FILTER (WHERE NOT d.done) > 0
      ORDER BY pending_cnt DESC, b.brand_name`,
  ).catch(() => [])) as unknown as DocRow[];
  const docRowsF = docRows.filter((r) => matchBrand(r.brand_name, r.grade));

  const logiRows = (await query(
    `SELECT l.brand_id, b.brand_name, b.grade, l.country, l.provider, l.status, l.end_date
       FROM logistics_contracts l
       JOIN brands b ON b.id = l.brand_id
      WHERE COALESCE(b.is_test, false) = false
      ORDER BY b.brand_name, l.country`,
  ).catch(() => [])) as unknown as LogiRow[];
  const logiRowsF = logiRows.filter(
    (r) => matchBrand(r.brand_name, r.grade) && (!country || r.country === country),
  );

  const logRows = (await query(
    `SELECT b.brand_name, b.grade, d.template, d.label, d.done_at, d.done_by
       FROM doc_items d
       JOIN brands b ON b.id = d.brand_id
      WHERE COALESCE(b.is_test, false) = false
        AND d.done = true AND d.done_at IS NOT NULL
      ORDER BY d.done_at DESC
      LIMIT 8`,
  ).catch(() => [])) as unknown as LogRow[];
  const logRowsF = logRows.filter((r) => matchBrand(r.brand_name, r.grade));

  const today = new Date().toISOString().slice(0, 10);
  const isExpired = (r: LogiRow) =>
    r.status === "expired" || (!!r.end_date && r.end_date < today);

  // ── 통계 (실데이터 롤업 · 필터 반영) ─────────────────
  const pendingTotal = docRowsF.reduce((s, r) => s + (r.pending_cnt || 0), 0);
  const activeCnt = logiRowsF.filter(
    (r) => (r.status === "active" || r.status === "contracted") && !isExpired(r),
  ).length;
  const negotiatingCnt = logiRowsF.filter((r) => r.status === "negotiating").length;
  const expiredCnt = logiRowsF.filter(isExpired).length;

  // ── 브랜드별 물류 요약 (메인 테이블 셀용) ────────────
  const byBrand = new Map<string, LogiRow[]>();
  for (const r of logiRowsF) {
    const arr = byBrand.get(r.brand_id) ?? [];
    arr.push(r);
    byBrand.set(r.brand_id, arr);
  }
  function logiCell(brandId: string) {
    const arr = byBrand.get(brandId) ?? [];
    if (arr.length === 0)
      return <span className="cellchip cc-no">미착수</span>;
    const ok = arr.filter(
      (r) => (r.status === "active" || r.status === "contracted") && !isExpired(r),
    );
    const ing = arr.filter((r) => r.status === "negotiating");
    const exp = arr.filter(isExpired);
    return (
      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        {ok.length > 0 && (
          <span className="cellchip cc-ok">
            {ok.map((r) => r.country).join("·")} ✓
          </span>
        )}
        {ing.length > 0 && (
          <span className="cellchip cc-ing">
            {ing.map((r) => r.country).join("·")} 협의
          </span>
        )}
        {exp.length > 0 && (
          <span className="cellchip cc-exp">
            {exp.map((r) => r.country).join("·")} 만료
          </span>
        )}
        {ok.length === 0 && ing.length === 0 && exp.length === 0 && (
          <span className="cellchip cc-no">대기</span>
        )}
      </span>
    );
  }

  // ── 물류 계약 보드용 매트릭스 ─────────────────────────
  const boardBrands = Array.from(byBrand.entries()).map(([id, arr]) => ({
    id,
    name: arr[0].brand_name,
    cell: (code: string) => arr.find((r) => r.country === code) ?? null,
  }));

  // 국가 필터 시 해당 열만 표시
  const shownCountries = country ? COUNTRIES.filter((c) => c.code === country) : COUNTRIES;

  return (
    <div>
      <ScreenHeader
        title="서류·물류"
        desc="서류 체크리스트 미완 브랜드와 국가별 물류 계약 현황 (크로스-브랜드)"
      />

      {/* 검색·필터 바 (GET → searchParams, 실데이터 필터) */}
      <form method="GET" className="bar">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          style={{ width: 220 }}
          placeholder="브랜드명 검색"
        />
        <select name="grade" defaultValue={grade} style={{ width: 110 }}>
          <option value="">등급 전체</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select name="country" defaultValue={country} style={{ width: 120 }}>
          <option value="">국가 전체</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" type="submit">검색</button>
        {filterActive && <Link href="/docs" className="btn btn-sm">초기화</Link>}
      </form>

      {/* 요약 타일 */}
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="tile">
          <div className="k">서류 수급 중</div>
          <div className="v">{docRowsF.length}</div>
          <div className="d">미제출 {pendingTotal}건</div>
        </div>
        <div className={pendingTotal > 0 ? "tile alert" : "tile"}>
          <div className="k">미제출 항목</div>
          <div className="v" style={pendingTotal > 0 ? { color: "var(--danger)" } : undefined}>
            {pendingTotal}
          </div>
          <div className="d">체크리스트 미완 항목 합계</div>
        </div>
        <div className="tile">
          <div className="k">물류 계약</div>
          <div className="v">{logiRowsF.length}</div>
          <div className="d">운영·계약 {activeCnt} · 협의 {negotiatingCnt}</div>
        </div>
        <div className={expiredCnt > 0 ? "tile alert" : "tile"}>
          <div className="k">계약 만료</div>
          <div className="v" style={expiredCnt > 0 ? { color: "var(--danger)" } : undefined}>
            {expiredCnt}
          </div>
          <div className="d dn">{expiredCnt > 0 ? "갱신 필요" : "만료 없음"}</div>
        </div>
      </div>

      {/* 서류 체크리스트 미완 브랜드 */}
      <div className="card overflow-x-auto">
        <div className="card-hd"><b>서류 체크리스트 미완 ({docRowsF.length})</b></div>
        <table className="t">
          <thead>
            <tr>
              <th>브랜드</th>
              <th>템플릿</th>
              <th style={{ width: 220 }}>진행</th>
              <th>미제출 항목</th>
              <th>물류 계약</th>
              <th style={{ textAlign: "right" }}>미완</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {docRowsF.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "var(--ink3)" }}>
                  {filterActive ? "조건에 맞는 미완 서류가 없습니다." : "미완 서류가 없습니다."}
                </td>
              </tr>
            )}
            {docRowsF.map((r) => {
              const total = r.total || 0;
              const done = r.done_cnt || 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const complete = total > 0 && done >= total;
              const tmpls = (r.templates ?? "")
                .split(",")
                .filter(Boolean)
                .map((t) => TEMPLATE_KO[t] ?? t)
                .join(" · ");
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/brand/${r.id}`} className="font-semibold hover:underline">
                      {r.brand_name}
                    </Link>{" "}
                    <GradeBadge grade={r.grade as Grade | null} />
                  </td>
                  <td style={{ color: "var(--ink3)" }}>{tmpls || "—"}</td>
                  <td>
                    <div className="pr">
                      <i className={complete ? "g" : "w"} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="sub">{done}/{total}</span>
                  </td>
                  <td style={{ color: "var(--ink3)" }}>{r.pending_labels || "—"}</td>
                  <td>{logiCell(r.id)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--danger)" }}>
                    {r.pending_cnt}건
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/brand/${r.id}`} className="btn sm">보기</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 하단 2단: 동기 로그 · 물류 계약 보드 */}
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="hd"><b>서류 동기 로그 (최근 갱신)</b></div>
          <div className="bd" style={{ fontSize: 12 }}>
            {logRowsF.length === 0 && (
              <div style={{ color: "var(--ink3)" }}>최근 갱신된 서류가 없습니다.</div>
            )}
            {logRowsF.map((r, i) => (
              <div className="row" key={i}>
                <span className="ico i-grn">↓</span>
                <div>
                  <div className="tt">
                    {r.brand_name} · {r.label}
                    {r.template ? ` (${TEMPLATE_KO[r.template] ?? r.template})` : ""}
                  </div>
                  <div className="ss">
                    {(r.done_at ?? "").slice(0, 16).replace("T", " ")}
                    {r.done_by ? ` · ${r.done_by}` : ""} · 체크리스트 완료
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card overflow-x-auto">
          <div className="hd"><b>물류 계약 보드</b></div>
          <div className="bd">
            <table className="t">
              <thead>
                <tr>
                  <th>브랜드</th>
                  {shownCountries.map((c) => (
                    <th key={c.code}>{c.flag}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boardBrands.length === 0 && (
                  <tr>
                    <td colSpan={shownCountries.length + 1} style={{ color: "var(--ink3)" }}>
                      물류 계약이 없습니다.
                    </td>
                  </tr>
                )}
                {boardBrands.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/brand/${b.id}`} className="font-semibold hover:underline">
                        {b.name}
                      </Link>
                    </td>
                    {shownCountries.map((c) => {
                      const cell = b.cell(c.code);
                      if (!cell) return <td key={c.code}><span className="cellchip cc-no">—</span></td>;
                      const expired = isExpired(cell);
                      const st = LOGI_ST[cell.status ?? "none"] ?? { ko: cell.status ?? "—", cc: "cc-no" };
                      const label = expired
                        ? "만료"
                        : (cell.status === "active" || cell.status === "contracted") && cell.provider
                          ? cell.provider
                          : st.ko;
                      return (
                        <td key={c.code}>
                          <span className={`cellchip ${expired ? "cc-exp" : st.cc}`}>{label}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
