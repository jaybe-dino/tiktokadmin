import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getApplicationByCustomer } from "@/lib/onboarding";
import LoaDocument from "@/components/LoaDocument";

export const dynamic = "force-dynamic";

export default async function LoaPage({ params }: { params: Promise<{ customerId: string }> }) {
  await currentUser();
  const { customerId } = await params;
  const app = await getApplicationByCustomer(customerId);
  if (!app) notFound();
  const back = `/onboarding/${customerId}`;

  if (!String(app.ubo_signature_data ?? "").trim()) {
    return (
      <div className="max-w-3xl" style={{ padding: 24 }}>
        <Link href={back} className="btn sm">← 검토로</Link>
        <div className="card" style={{ marginTop: 12 }}><div className="card-bd"><p className="note">아직 대표자 서명(LOA)이 제출되지 않았습니다.</p></div></div>
      </div>
    );
  }
  return <LoaDocument app={app} backHref={back} />;
}
