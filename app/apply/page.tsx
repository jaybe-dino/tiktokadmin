import { redirect } from "next/navigation";
import {
  currentOnbCustomer, getOrCreateApplication, getApplicationById, getSteps,
  listOnbFiles, COMPANY_DOCS_FIELD,
  getCountries, getProducts, getProductCountries,
} from "@/lib/onboarding";
import ApplyForm from "./ApplyForm";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const customer = await currentOnbCustomer();
  if (!customer) redirect("/apply/login");

  const { id: appId } = await getOrCreateApplication(customer.id, customer.brand_id);
  const [app, steps, countries, products] = await Promise.all([
    getApplicationById(appId),
    getSteps(appId),
    getCountries(appId),
    getProducts(appId),
  ]);
  const productCountries: Record<string, Awaited<ReturnType<typeof getProductCountries>>> = {};
  for (const p of products) productCountries[p.id] = await getProductCountries(p.id);
  // 회사자료(브랜드 소개서 등) 다중 첨부 — 0101 미적용이면 빈 목록으로 두고 화면에서 안내한다.
  const companyDocs = await listOnbFiles(appId, COMPANY_DOCS_FIELD).catch(() => []);

  return (
    <ApplyForm
      email={customer.email}
      agencyName={customer.agency_name ?? ""}
      companyDocs={companyDocs}
      app={app ?? {}}
      steps={steps}
      countries={countries}
      products={products}
      productCountries={productCountries}
    />
  );
}
