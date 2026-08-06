import Link from "next/link";
import { notFound } from "next/navigation";
import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import {
  getApplicationByCustomer, getApplicationById, getSteps,
  getCountries, getProducts, getProductCountries,
} from "@/lib/onboarding";
import ReviewClient from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function OnbReviewPage({ params }: { params: Promise<{ customerId: string }> }) {
  await currentUser();
  const { customerId } = await params;
  const customer = await queryOne<{ id: string; email: string; brand_id: string | null; note: string }>(
    "SELECT id, email, brand_id, note FROM onb_customers WHERE id=$1", [customerId]).catch(() => null);
  if (!customer) notFound();

  const appRow = await getApplicationByCustomer(customerId);
  if (!appRow) {
    return (
      <div className="max-w-4xl">
        <ScreenHeader title={customer.email} desc="아직 신청서를 시작하지 않았습니다." right={<Link className="btn sm" href="/onboarding">← 목록</Link>} />
      </div>
    );
  }
  const appId = String(appRow.id);
  const [app, steps, countries, products] = await Promise.all([
    getApplicationById(appId), getSteps(appId), getCountries(appId), getProducts(appId),
  ]);
  const brand = customer.brand_id
    ? await queryOne<{ brand_name: string }>("SELECT brand_name FROM brands WHERE id=$1", [customer.brand_id]).catch(() => null)
    : null;
  const productCountries: Record<string, Awaited<ReturnType<typeof getProductCountries>>> = {};
  for (const p of products) productCountries[p.id] = await getProductCountries(p.id);

  return (
    <div style={{ background: "#fff", margin: "-20px -22px -64px", padding: "20px 22px 64px", minHeight: "calc(100vh - 52px)" }}>
    <div className="max-w-4xl">
      <ScreenHeader
        title={customer.email}
        desc={`신청서 상태: ${String(app?.status ?? "draft")}${brand ? ` · 연결 브랜드: ${brand.brand_name}` : " · 브랜드 미연결"}`}
        right={<Link className="btn sm" href="/onboarding">← 목록</Link>}
      />
      <ReviewClient
        applicationId={appId}
        appStatus={String(app?.status ?? "draft")}
        hasBrand={!!customer.brand_id}
        app={app ?? {}}
        steps={steps}
        countries={countries}
        products={products}
        productCountries={productCountries}
      />
    </div>
    </div>
  );
}
