import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { listMktProposals } from "@/lib/mkt-proposal-doc";
import { listSurveyEligibleBrands } from "@/lib/mkt-proposal2";
import GenerateMktProposal2 from "./GenerateMktProposal2";

export const dynamic = "force-dynamic";

const STATUS_KO: Record<string, string> = { draft: "작성 중", sent: "발송", accepted: "수주", rejected: "드랍" };

export default async function MktProposals2Page() {
  await currentUser();
  const [docs, brands] = await Promise.all([
    listMktProposals({ genSource: "auto" }),
    listSurveyEligibleBrands(),
  ]);

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="마케팅 제안서2 (설문 자동생성)"
        desc="마케팅 설문 응답(A2 대표 상품 링크·D16 예산·B8 진출국가)을 읽어 제목·제품·예산·국가를 자동으로 채웁니다. 생성 후 에디터에서 텍스트만 다듬으면 됩니다 — 기존 「마케팅 제안서」(수동)와는 별개 목록입니다."
        right={<Link href="/mkt-proposals" className="btn sm">📝 수동 작성(1번째 방식) →</Link>}
      />

      <GenerateMktProposal2 brands={brands} />

      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 600 }}>자동생성된 제안서</div>
        {docs.length === 0 ? (
          <div style={{ padding: 24, color: "var(--ink2)", fontSize: 14 }}>아직 자동생성된 제안서가 없습니다. 위에서 설문 응답이 있는 브랜드를 선택해 생성하세요.</div>
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
