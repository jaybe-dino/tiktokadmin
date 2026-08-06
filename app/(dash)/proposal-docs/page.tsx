import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { listProposals } from "@/lib/proposal-doc";
import { query } from "@/lib/db";
import NewProposalDoc from "./NewProposalDoc";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const TRACK: Record<string, string> = { onboarding: "온보딩", mall: "멀티몰", marketing: "마케팅" };

// 제안서 생성기(웹 제안서) — 조건 세팅 + 제품·크리에이터 레퍼런스 → 공개 링크 렌더.
export default async function ProposalDocsPage() {
  await currentUser();
  const [docs, brands] = await Promise.all([
    listProposals(),
    query<{ id: string; brand_name: string }>("SELECT id, brand_name FROM brands WHERE state NOT IN ('dropped','churned') ORDER BY brand_name").catch(() => []),
  ]);
  const base = env.portalUrl;

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title="운영 제안서 (웹 제안서)"
        desc={`총 ${docs.length}건 · 온보딩·멀티몰 운영대행 제안서 — 조건·제품·크리에이터 레퍼런스로 디자인 제안서를 공개 링크로 생성`}
        right={<Link className="btn sm" href="/proposal-docs/templates">🎨 템플릿/디자인</Link>}
      />

      <NewProposalDoc brands={brands} />

      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 600 }}>제안서 목록</div>
        {docs.length === 0 ? (
          <div style={{ padding: 24, color: "var(--ink2)", fontSize: 14 }}>아직 생성된 제안서가 없습니다. 위에서 브랜드를 선택해 생성하세요.</div>
        ) : (
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead><tr style={{ textAlign: "left", color: "var(--ink2)", fontSize: 12 }}>
              <th style={th}>제목</th><th style={th}>브랜드</th><th style={th}>트랙</th><th style={th}>상태</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{d.title}</div><div style={{ fontSize: 11, color: "var(--ink2)" }}>{d.subtitle}</div></td>
                  <td style={td}>{d.brand_name || "—"}</td>
                  <td style={td}>{TRACK[d.track] ?? d.track}</td>
                  <td style={td}><span style={{ color: d.status === "published" ? "#12b886" : "#f0a02c", fontWeight: 600 }}>{d.status === "published" ? "발행됨" : "초안"}</span></td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link className="btn sm" href={`/proposal-docs/${d.id}`}>편집</Link>
                    <a className="btn sm" href={`${base}/proposal/${d.token}`} target="_blank" style={{ marginLeft: 6 }}>미리보기 ↗</a>
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

const th: React.CSSProperties = { padding: "9px 14px", borderBottom: "1px solid var(--line)", fontWeight: 600 };
const td: React.CSSProperties = { padding: "10px 14px", borderBottom: "1px solid var(--line)", verticalAlign: "middle" };
