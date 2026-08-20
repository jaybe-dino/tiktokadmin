import { notFound } from "next/navigation";
import { getMktProposalByToken } from "@/lib/mkt-proposal-doc";
import MktProposalView from "@/components/MktProposalView";
import MktPrintBar from "@/components/MktPrintBar";

export const dynamic = "force-dynamic";

export default async function MktProposalTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await getMktProposalByToken(token);
  if (!doc) notFound();
  return (
    <div style={{ background: "#e9ebef", minHeight: "100vh" }}>
      <MktPrintBar title={doc.title || `${doc.brand_name ?? ""} 마케팅 제안서`} />
      <MktProposalView doc={doc} />
    </div>
  );
}
