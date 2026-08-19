import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getMktProposalById } from "@/lib/mkt-proposal-doc";
import MktProposalEditor from "./MktProposalEditor";

export const dynamic = "force-dynamic";

export default async function MktProposalEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await currentUser();
  const [doc, brands] = await Promise.all([
    getMktProposalById(id),
    query<{ id: string; brand_name: string }>(
      "SELECT id, brand_name FROM brands WHERE state NOT IN ('dropped','churned') ORDER BY brand_name",
    ).catch(() => []),
  ]);
  if (!doc) notFound();
  return <MktProposalEditor doc={doc} brands={brands} />;
}
