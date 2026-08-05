import { notFound } from "next/navigation";
import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { getProposalById } from "@/lib/proposal-doc";
import { env } from "@/lib/env";
import ProposalEditor from "./ProposalEditor";

export const dynamic = "force-dynamic";

export default async function ProposalDocEditPage({ params }: { params: Promise<{ id: string }> }) {
  await currentUser();
  const { id } = await params;
  const doc = await getProposalById(id);
  if (!doc) notFound();

  return (
    <div className="max-w-4xl">
      <ScreenHeader
        title="제안서 편집"
        desc={doc.brand_name || "브랜드 미지정"}
        right={<Link className="btn sm" href="/proposal-docs">← 목록</Link>}
      />
      <ProposalEditor doc={doc} publicBase={env.portalUrl} />
    </div>
  );
}
