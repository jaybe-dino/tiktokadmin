import { notFound } from "next/navigation";
import { getMktProposalByToken } from "@/lib/mkt-proposal-doc";
import { proposalAssetUrl } from "@/lib/asset-url";
import MktProposalView from "@/components/MktProposalView";
import MktPrintBar from "@/components/MktPrintBar";

export const dynamic = "force-dynamic";

export default async function MktProposalTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await getMktProposalByToken(token);
  if (!doc) notFound();
  // 이미지 URL 정리 — 드라이브 공유링크 변환 + 세션 보호 파일은 토큰 프록시로(로그인 없는 열람자도 표시).
  doc.products_json = (doc.products_json ?? []).map((p) => ({ ...p, image_url: p.image_url ? proposalAssetUrl(p.image_url, token) : p.image_url }));
  doc.references_json = (doc.references_json ?? []).map((r) => ({ ...r, image_url: r.image_url ? proposalAssetUrl(r.image_url, token) : r.image_url }));
  return (
    <div style={{ background: "#e9ebef", minHeight: "100vh" }}>
      <MktPrintBar title={doc.title || `${doc.brand_name ?? ""} 마케팅 제안서`} />
      <MktProposalView doc={doc} />
    </div>
  );
}
