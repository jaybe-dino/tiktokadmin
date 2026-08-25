import { notFound } from "next/navigation";
import { getMktProposalByToken } from "@/lib/mkt-proposal-doc";
import { proposalImageUrl } from "@/lib/asset-url";
import MktProposalView from "@/components/MktProposalView";
import MktPrintBar from "@/components/MktPrintBar";

export const dynamic = "force-dynamic";

export default async function MktProposalTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await getMktProposalByToken(token);
  if (!doc) notFound();
  // 이미지 URL 정리 — 보호 파일은 토큰 프록시, 외부 이미지는 웹썸네일 프록시(핫링크 차단·만료 URL 도 표시+영구 캐시).
  doc.products_json = (doc.products_json ?? []).map((p) => ({ ...p, image_url: p.image_url ? proposalImageUrl(p.image_url, token) : p.image_url }));
  doc.references_json = (doc.references_json ?? []).map((r) => ({ ...r, image_url: r.image_url ? proposalImageUrl(r.image_url, token) : r.image_url }));
  return (
    <div style={{ background: "#e9ebef", minHeight: "100vh" }}>
      <MktPrintBar title={doc.title || `${doc.brand_name ?? ""} 마케팅 제안서`} />
      <MktProposalView doc={doc} />
    </div>
  );
}
