import Link from "next/link";
import { won } from "@/components/ScreenHeader";
import { allProposals } from "@/lib/repo/global";
import { query } from "@/lib/db";
import QuoteBuilder from "./QuoteBuilder";
import ProposalRowActions from "./ProposalRowActions";
import NewProposalButton from "./NewProposalButton";

export const dynamic = "force-dynamic";

const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "초안", c: "cc-warn" },
  sent: { ko: "발송됨", c: "cc-ing" },
  accepted: { ko: "수락 → 계약검토", c: "cc-ok" },
  rejected: { ko: "거절", c: "cc-exp" },
  superseded: { ko: "대체됨", c: "cc-no" },
};

function fmtDate(v: unknown): string {
  return v ? new Date(v as string).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "—";
}

export default async function ProposalsPage() {
  const rows = (await allProposals().catch(() => [])) as Record<string, unknown>[];
  const brands = (await query(
    `SELECT id, brand_name FROM brands
      WHERE state NOT IN ('dropped','churned')
      ORDER BY brand_name LIMIT 500`,
  ).catch(() => [])) as { id: string; brand_name: string }[];
  const brandOpts = brands.map((b) => ({ id: b.id, name: b.brand_name }));

  return (
    <div>
      <div className="ph">
        <div>
          <h1>제안서</h1>
          <p>진단·설문·견적 로직을 조합해 생성 — 발송 기록이 계약검토 게이트 조건입니다.</p>
        </div>
        <NewProposalButton />
      </div>

      <div className="grid g31">
        {/* 좌: 제안서 목록 */}
        <div className="card overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>브랜드</th>
                <th>플랜 구성</th>
                <th>견적</th>
                <th>상태</th>
                <th>발송</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--ink3)" }}>제안서가 없습니다.</td>
                </tr>
              )}
              {rows.map((p) => {
                const st = ST[p.status as string] ?? { ko: (p.status as string) ?? "—", c: "cc-no" };
                const status = p.status as string;
                const plan = (p.plan as string) ?? "—";
                const term = (p.term as string) ?? "";
                const countries = ((p.countries as string[]) ?? []).join("·");
                const planLine = [plan, countries].filter(Boolean).join(" · ");
                return (
                  <tr key={p.id as string}>
                    <td>
                      <Link href={`/brand/${p.brand_id}`} className="hover:underline"><b>{p.brand_name as string}</b></Link>
                      {p.grade ? <span className={`gr ${p.grade as string}`} style={{ marginLeft: 6 }}>{p.grade as string}</span> : null}
                    </td>
                    <td>
                      {planLine}
                      {term ? <span className="sub">{term}</span> : null}
                    </td>
                    <td className="font-semibold">{status === "draft" ? "작성 중" : won(p.amount as number)}</td>
                    <td><span className={`cellchip ${st.c}`}>{st.ko}</span></td>
                    <td style={{ color: "var(--ink3)" }}>{fmtDate(p.sent_at)}</td>
                    <td>
                      <ProposalRowActions
                        id={p.id as string}
                        brandId={p.brand_id as string}
                        status={status}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 우: 견적 빌더 */}
        <QuoteBuilder brands={brandOpts} />
      </div>
    </div>
  );
}
