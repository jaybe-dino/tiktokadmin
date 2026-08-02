import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { GradeBadge } from "@/components/badges";
import { query } from "@/lib/db";
import type { Grade } from "@/lib/types";

export const dynamic = "force-dynamic";

const TEMPLATE_KO: Record<string, string> = { mall: "멀티몰", onboarding: "온보딩" };

const LOGI_ST: Record<string, { ko: string; cc: string }> = {
  none: { ko: "대기", cc: "cc-no" },
  negotiating: { ko: "협의", cc: "cc-ing" },
  contracted: { ko: "계약", cc: "cc-ok" },
  active: { ko: "운영", cc: "cc-ok" },
  expired: { ko: "만료", cc: "cc-exp" },
};

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

export default async function DocsPage() {
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

  const logiRows = (await query(
    `SELECT l.brand_id, b.brand_name, b.grade, l.country, l.provider, l.status, l.end_date
       FROM logistics_contracts l
       JOIN brands b ON b.id = l.brand_id
      WHERE COALESCE(b.is_test, false) = false
      ORDER BY b.brand_name, l.country`,
  ).catch(() => [])) as unknown as LogiRow[];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <ScreenHeader
        title="서류·물류"
        desc="서류 체크리스트 미완 브랜드와 국가별 물류 계약 현황 (크로스-브랜드)"
      />

      {/* 서류 체크리스트 미완 브랜드 */}
      <div className="card overflow-x-auto">
        <div className="card-hd"><b>서류 체크리스트 미완 ({docRows.length})</b></div>
        <table className="t">
          <thead>
            <tr>
              <th>브랜드</th>
              <th>템플릿</th>
              <th style={{ width: 220 }}>진행률</th>
              <th>미완 항목</th>
              <th style={{ textAlign: "right" }}>미완</th>
            </tr>
          </thead>
          <tbody>
            {docRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--ink3)" }}>미완 서류가 없습니다.</td>
              </tr>
            )}
            {docRows.map((r) => {
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
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--danger)" }}>
                    {r.pending_cnt}건
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 국가별 물류 계약 현황 */}
      <div className="card overflow-x-auto" style={{ marginTop: 14 }}>
        <div className="card-hd"><b>국가별 물류 계약 ({logiRows.length})</b></div>
        <table className="t">
          <thead>
            <tr>
              <th>브랜드</th>
              <th>국가</th>
              <th>Provider</th>
              <th>상태</th>
              <th>만료</th>
            </tr>
          </thead>
          <tbody>
            {logiRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--ink3)" }}>물류 계약이 없습니다.</td>
              </tr>
            )}
            {logiRows.map((r, i) => {
              const st = LOGI_ST[r.status ?? "none"] ?? { ko: r.status ?? "—", cc: "cc-no" };
              const expired = !!r.end_date && r.end_date < today;
              return (
                <tr key={`${r.brand_id}-${r.country}-${i}`}>
                  <td>
                    <Link href={`/brand/${r.brand_id}`} className="font-semibold hover:underline">
                      {r.brand_name}
                    </Link>{" "}
                    <GradeBadge grade={r.grade as Grade | null} />
                  </td>
                  <td>{r.country}</td>
                  <td style={{ color: "var(--ink3)" }}>{r.provider || "—"}</td>
                  <td>
                    <span className={`cellchip ${expired ? "cc-exp" : st.cc}`}>
                      {expired ? "만료" : st.ko}
                    </span>
                  </td>
                  <td style={{ color: expired ? "var(--danger)" : "var(--ink3)", fontWeight: expired ? 700 : 400 }}>
                    {r.end_date || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
