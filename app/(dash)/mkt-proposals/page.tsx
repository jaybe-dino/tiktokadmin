import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { listMktProposals } from "@/lib/mkt-proposal-doc";
import NewMktProposal from "./NewMktProposal";

export const dynamic = "force-dynamic";

const STATUS_KO: Record<string, string> = { draft: "작성 중", sent: "발송", accepted: "수주", rejected: "드랍" };

export default async function MktProposalsPage() {
  await currentUser();
  const [docs, brands] = await Promise.all([
    listMktProposals(),
    query<{ id: string; brand_name: string }>(
      "SELECT id, brand_name FROM brands WHERE state NOT IN ('dropped','churned') ORDER BY brand_name",
    ).catch(() => []),
  ]);

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="마케팅 제안서"
        desc="TikTok Shop 마케팅 협업 제안서 — 예산 자동계산(무가·유가·GMV) + 국가 시즌 캘린더. 운영 제안서와 별개."
      />
      <NewMktProposal brands={brands} />

      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 600 }}>제안서 목록</div>
        {docs.length === 0 ? (
          <div style={{ padding: 24, color: "var(--ink2)", fontSize: 14 }}>아직 마케팅 제안서가 없습니다. 위에서 브랜드를 선택해 생성하세요.</div>
        ) : (
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink2)", fontSize: 12 }}>
                <th style={th}>제목</th><th style={th}>브랜드</th><th style={th}>월 예산</th><th style={th}>상태</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={td}><Link href={`/mkt-proposals/${d.id}`} className="hover:underline" style={{ fontWeight: 600 }}>{d.title || "(제목 없음)"}</Link></td>
                  <td style={td}>{d.brand_name ?? "—"}</td>
                  <td style={td}>{Math.round(d.monthly_budget / 10000).toLocaleString("ko-KR")}만원</td>
                  <td style={td}><span className="chip">{STATUS_KO[d.status] ?? d.status}</span></td>
                  <td style={td}>
                    <Link href={`/mkt-proposals/${d.id}`} className="btn sm">편집</Link>{" "}
                    <a href={`/mkt-proposal/${d.token}`} target="_blank" rel="noreferrer" className="btn sm">미리보기 ↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "9px 14px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "9px 14px" };
