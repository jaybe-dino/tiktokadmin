import { notFound } from "next/navigation";
import { getMktProposalByToken } from "@/lib/mkt-proposal-doc";
import MktProposalView from "@/components/MktProposalView";

export const dynamic = "force-dynamic";

export default async function MktProposalTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await getMktProposalByToken(token);
  if (!doc) notFound();
  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: "16px 0" }}>
      <MktProposalView doc={doc} />
    </div>
  );
}
