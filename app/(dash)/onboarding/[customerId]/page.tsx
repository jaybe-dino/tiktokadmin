import Link from "next/link";
import { notFound } from "next/navigation";
import ScreenHeader from "@/components/ScreenHeader";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import {
  getApplicationByCustomer, getApplicationById, getSteps,
  getCountries, getProducts, getProductCountries,
  listOnbFiles, COMPANY_DOCS_FIELD,
} from "@/lib/onboarding";
import ReviewClient from "./ReviewClient";
import NoAppActions from "./NoAppActions";

export const dynamic = "force-dynamic";

export default async function OnbReviewPage({ params }: { params: Promise<{ customerId: string }> }) {
  await currentUser();
  const { customerId } = await params;
  const customer = await loadCustomer(customerId);
  if (!customer) notFound();

  const appRow = await getApplicationByCustomer(customerId);
  if (!appRow) {
    return (
      <div className="max-w-4xl">
        <ScreenHeader
          title={customer.email}
          desc={`아직 신청서를 시작하지 않았습니다.${customer.agency_name ? ` · 에이전시: ${customer.agency_name}` : ""}`}
          right={<Link className="btn sm" href="/onboarding">← 목록</Link>}
        />
        <NoAppActions customerId={customerId} hasBrand={!!customer.brand_id} />
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
  // 회사자료(브랜드 소개서 등) 첨부 — 0101 미적용이면 빈 목록.
  const companyDocs = await listOnbFiles(appId, COMPANY_DOCS_FIELD).catch(() => []);

  return (
    <div style={{ background: "#fff", margin: "-20px -22px -64px", padding: "20px 22px 64px", minHeight: "calc(100vh - 52px)" }}>
    <div className="max-w-4xl">
      <ScreenHeader
        title={customer.email}
        desc={`신청서 상태: ${String(app?.status ?? "draft")}${brand ? ` · 연결 브랜드: ${brand.brand_name}` : " · 브랜드 미연결"}${customer.agency_name ? ` · 에이전시: ${customer.agency_name}` : ""}`}
        right={<Link className="btn sm" href="/onboarding">← 목록</Link>}
      />
      <ReviewClient
        applicationId={appId}
        customerId={customerId}
        appStatus={String(app?.status ?? "draft")}
        hasBrand={!!customer.brand_id}
        app={app ?? {}}
        steps={steps}
        countries={countries}
        products={products}
        productCountries={productCountries}
        agencyName={customer.agency_name}
        companyDocs={companyDocs}
      />
    </div>
    </div>
  );
}

interface OnbCustomerRow { id: string; email: string; brand_id: string | null; note: string; agency_name: string }

// agency_name 은 0101 마이그레이션에서 추가된다 — 미적용 DB 에서도 페이지가 떠야 하므로
//   컬럼이 없으면 빈 값으로 한 번 더 조회한다(다른 DB 오류는 숨기지 않고 그대로 올린다).
async function loadCustomer(customerId: string): Promise<OnbCustomerRow | null> {
  try {
    return await queryOne<OnbCustomerRow>(
      "SELECT id, email, brand_id, note, coalesce(agency_name,'') AS agency_name FROM onb_customers WHERE id=$1",
      [customerId]);
  } catch (e) {
    if (!/agency_name/.test((e as Error).message)) throw e;
    const r = await queryOne<Omit<OnbCustomerRow, "agency_name">>(
      "SELECT id, email, brand_id, note FROM onb_customers WHERE id=$1", [customerId]);
    return r ? { ...r, agency_name: "" } : null;
  }
}
