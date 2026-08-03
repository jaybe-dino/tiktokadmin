import Link from "next/link";
import { won } from "@/components/ScreenHeader";
import { query } from "@/lib/db";
import QuoteBuilder from "./QuoteBuilder";
import ProposalRowActions from "./ProposalRowActions";
import NewProposalButton from "./NewProposalButton";
import { checkProposalFollowups } from "./followup-check";

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

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  // 간이 크론 — 발송 후 3일 미계약 제안서 → proposal_stale 알림 upsert (실패 무시).
  await checkProposalFollowups().catch(() => {});

  // 목록 — 검색어가 있으면 회사명(brand_company)·브랜드명·사업자번호(brands.biz_no)로 필터.
  const rows = (await query(
    `SELECT p.id, p.version, p.plan, p.countries, p.term,
            COALESCE(p.quote_amount, p.amount) AS amount, p.status, p.sent_at, p.created_at,
            p.contract_term, p.billing_day, p.contract_file_url, p.followup_due,
            b.brand_name, b.id AS brand_id, b.grade
       FROM proposals p
       JOIN brands b ON b.id = p.brand_id
       LEFT JOIN brand_company bc ON bc.brand_id = b.id
      WHERE $1 = ''
         OR b.brand_name ILIKE $2
         OR COALESCE(b.brand_name_en, '') ILIKE $2
         OR COALESCE(bc.company_name_kr, '') ILIKE $2
         OR COALESCE(bc.company_name_en, '') ILIKE $2
         OR COALESCE(b.biz_no, '') ILIKE $2
      ORDER BY p.created_at DESC LIMIT 200`,
    [q, `%${q}%`],
  ).catch(() => [])) as Record<string, unknown>[];

  const brands = (await query(
    `SELECT id, brand_name FROM brands
      WHERE state NOT IN ('dropped','churned')
      ORDER BY brand_name LIMIT 500`,
  ).catch(() => [])) as { id: string; brand_name: string }[];
  const brandOpts = brands.map((b) => ({ id: b.id, name: b.brand_name }));

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="ph">
        <div>
          <h1>제안서</h1>
          <p>진단·설문·견적 로직을 조합해 생성 — 발송 기록이 계약검토 게이트 조건입니다.</p>
        </div>
        <NewProposalButton />
      </div>

      {/* 검색 바 — 회사명 · 브랜드명 · 사업자번호 (GET → searchParams 서버 필터) */}
      <form method="GET" className="bar" style={{ marginBottom: 12 }}>
        <input
          className="f"
          name="q"
          defaultValue={q}
          placeholder="회사명 · 브랜드명 · 사업자번호 검색"
          style={{ maxWidth: 320 }}
        />
        <button className="btn" type="submit">검색</button>
        {q && (
          <Link href="/proposals" className="btn sm">초기화</Link>
        )}
      </form>

      <div className="grid g31">
        {/* 좌: 제안서 목록 */}
        <div className="card overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>브랜드</th>
                <th>플랜 구성</th>
                <th>견적</th>
                <th>계약조건</th>
                <th>상태</th>
                <th>발송</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--ink3)" }}>
                    {q ? `'${q}' 검색 결과가 없습니다.` : "제안서가 없습니다."}
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const st = ST[p.status as string] ?? { ko: (p.status as string) ?? "—", c: "cc-no" };
                const status = p.status as string;
                const plan = (p.plan as string) ?? "—";
                const term = (p.term as string) ?? "";
                const countries = ((p.countries as string[]) ?? []).join("·");
                const planLine = [plan, countries].filter(Boolean).join(" · ");
                const contractTerm = (p.contract_term as string) ?? "";
                const billingDay = p.billing_day as number | null;
                const contractUrl = (p.contract_file_url as string) ?? "";
                const followupDue = p.followup_due
                  ? String(p.followup_due).slice(0, 10)
                  : "";
                const stale = status === "sent" && followupDue !== "" && followupDue <= today;
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
                    <td style={{ fontSize: 12 }}>
                      {contractTerm || billingDay != null || contractUrl ? (
                        <>
                          {contractTerm && <span>{contractTerm}</span>}
                          {billingDay != null && (
                            <span className="sub">매월 {billingDay}일 결제</span>
                          )}
                          {contractUrl && (
                            <a href={contractUrl} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--acc)" }}>
                              계약서 ↗
                            </a>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "var(--ink3)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`cellchip ${st.c}`}>{st.ko}</span>
                      {stale && (
                        <span className="cellchip cc-warn" style={{ marginLeft: 4 }} title={`팔로업 기한 ${followupDue} 경과 — 미계약`}>
                          팔로업 필요
                        </span>
                      )}
                    </td>
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
          <div className="note" style={{ padding: "8px 12px" }}>
            생성 시 담당자 이메일 발송 초안이 초안함에 만들어집니다 — <Link href="/drafts" className="hover:underline" style={{ color: "var(--acc)" }}>초안함</Link>에서 승인해야 실제 발송됩니다. 발송 후 3일 내 미계약 시 담당 알림(proposal_stale)이 생성됩니다.
          </div>
        </div>

        {/* 우: 견적 빌더 */}
        <QuoteBuilder brands={brandOpts} />
      </div>
    </div>
  );
}
